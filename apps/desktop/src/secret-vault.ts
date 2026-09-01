import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { desktopSecretNameRequestSchema } from "@aquawisp/contracts";
import { z } from "zod";

const encryptedSecretFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.record(z.string(), z.base64()),
  })
  .strict();

interface EncryptedSecretFile {
  readonly schemaVersion: 1;
  readonly entries: Record<string, string>;
}

export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface SecretVaultOptions {
  readonly filePath: string;
  readonly maxSecretCharacters: number;
  readonly maxCiphertextBytes: number;
  readonly cipher: SecretCipher;
}

export class SecretVault {
  readonly #options: SecretVaultOptions;
  #mutationQueue = Promise.resolve();

  constructor(options: SecretVaultOptions) {
    this.#options = options;
  }

  async set(name: string, value: string): Promise<void> {
    const validatedName = desktopSecretNameRequestSchema.parse({ name }).name;
    if (!this.#options.cipher.isEncryptionAvailable()) {
      throw new Error("Operating-system secret encryption is unavailable");
    }
    if (value.length === 0 || value.length > this.#options.maxSecretCharacters) {
      throw new Error("Secret length is outside the configured limit");
    }
    const ciphertext = this.#options.cipher.encryptString(value);
    if (ciphertext.byteLength > this.#options.maxCiphertextBytes) {
      throw new Error("Encrypted secret exceeds the configured size limit");
    }
    await this.#mutate(async (file) => {
      file.entries[validatedName] = ciphertext.toString("base64");
      await this.#write(file);
    });
  }

  async has(name: string): Promise<boolean> {
    const validatedName = desktopSecretNameRequestSchema.parse({ name }).name;
    const file = await this.#read();
    return file.entries[validatedName] !== undefined;
  }

  async get(name: string): Promise<string | undefined> {
    const validatedName = desktopSecretNameRequestSchema.parse({ name }).name;
    if (!this.#options.cipher.isEncryptionAvailable()) {
      throw new Error("Operating-system secret encryption is unavailable");
    }
    const encoded = (await this.#read()).entries[validatedName];
    if (encoded === undefined) return undefined;
    const ciphertext = Buffer.from(encoded, "base64");
    if (ciphertext.byteLength > this.#options.maxCiphertextBytes) {
      throw new Error("Encrypted secret exceeds the configured size limit");
    }
    return this.#options.cipher.decryptString(ciphertext);
  }

  async delete(name: string): Promise<boolean> {
    const validatedName = desktopSecretNameRequestSchema.parse({ name }).name;
    return this.#mutate(async (file) => {
      if (file.entries[validatedName] === undefined) return false;
      const entries = Object.fromEntries(
        Object.entries(file.entries).filter(([name]) => name !== validatedName),
      );
      await this.#write({ ...file, entries });
      return true;
    });
  }

  async #read(): Promise<EncryptedSecretFile> {
    try {
      return encryptedSecretFileSchema.parse(
        JSON.parse(await readFile(this.#options.filePath, "utf8")) as unknown,
      );
    } catch (error) {
      if (isMissingFileError(error)) return { schemaVersion: 1, entries: {} };
      throw error;
    }
  }

  async #write(file: EncryptedSecretFile): Promise<void> {
    const directory = dirname(this.#options.filePath);
    const temporaryPath = `${this.#options.filePath}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(file)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.#options.filePath);
      if (process.platform !== "win32") await chmod(this.#options.filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  #mutate<T>(operation: (file: EncryptedSecretFile) => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(async () => operation(await this.#read()));
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
