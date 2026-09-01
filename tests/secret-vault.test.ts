import { SecretVault, type SecretCipher } from "@aquawisp/desktop";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

class TestCipher implements SecretCipher {
  readonly #available: boolean;

  constructor(available = true) {
    this.#available = available;
  }

  isEncryptionAvailable(): boolean {
    return this.#available;
  }

  encryptString(value: string): Buffer {
    return Buffer.from(`encrypted:${Buffer.from(value, "utf8").toString("base64")}`, "utf8");
  }

  decryptString(value: Buffer): string {
    const encoded = value.toString("utf8").replace(/^encrypted:/u, "");
    return Buffer.from(encoded, "base64").toString("utf8");
  }
}

describe("M5 encrypted secret vault", () => {
  it("persists ciphertext atomically and survives a new vault instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-secret-vault-"));
    const filePath = join(directory, "secrets.json");
    const options = {
      filePath,
      maxSecretCharacters: 128,
      maxCiphertextBytes: 1_024,
      cipher: new TestCipher(),
    };
    try {
      const vault = new SecretVault(options);
      await Promise.all([
        vault.set("bigmodel.api-key", "first-plaintext-key"),
        vault.set("deepseek.api-key", "second-plaintext-key"),
      ]);
      const stored = await readFile(filePath, "utf8");
      expect(stored).not.toContain("first-plaintext-key");
      expect(stored).not.toContain("second-plaintext-key");

      const restored = new SecretVault(options);
      expect(await restored.get("bigmodel.api-key")).toBe("first-plaintext-key");
      expect(await restored.has("deepseek.api-key")).toBe(true);
      expect(await restored.delete("deepseek.api-key")).toBe(true);
      expect(await restored.has("deepseek.api-key")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects writes when operating-system encryption is unavailable", async () => {
    const vault = new SecretVault({
      filePath: join(tmpdir(), "aquawisp-unavailable-secret-test.json"),
      maxSecretCharacters: 128,
      maxCiphertextBytes: 1_024,
      cipher: new TestCipher(false),
    });
    await expect(vault.set("provider.api-key", "plaintext-key")).rejects.toThrow("unavailable");
  });
});
