import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { desktopSettingsSchema, type DesktopSettings } from "@aquawisp/contracts";
import {
  getBuiltInModel,
  getBuiltInProvider,
  resolveReasoningLevel,
} from "@aquawisp/models-catalog";

export interface DesktopSettingsStoreOptions {
  readonly filePath: string;
  readonly defaults: DesktopSettings;
}

export class DesktopSettingsStore {
  readonly #filePath: string;
  readonly #defaults: DesktopSettings;
  #mutationQueue = Promise.resolve();

  constructor(options: DesktopSettingsStoreOptions) {
    this.#filePath = options.filePath;
    this.#defaults = validateSettings(options.defaults);
  }

  async get(): Promise<DesktopSettings> {
    try {
      return validateSettings(JSON.parse(await readFile(this.#filePath, "utf8")) as unknown);
    } catch (error) {
      if (isMissingFileError(error)) return this.#defaults;
      throw error;
    }
  }

  set(settings: unknown): Promise<DesktopSettings> {
    const result = this.#mutationQueue.then(async () => {
      const validated = validateSettings(settings);
      const directory = dirname(this.#filePath);
      const temporaryPath = `${this.#filePath}.tmp`;
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(temporaryPath, `${JSON.stringify(validated)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporaryPath, this.#filePath);
        if (process.platform !== "win32") await chmod(this.#filePath, 0o600);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
      return validated;
    });
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function validateSettings(input: unknown): DesktopSettings {
  const settings = desktopSettingsSchema.parse(input);
  const provider = getBuiltInProvider(settings.providerId);
  const model = getBuiltInModel(settings.modelId);
  if (model.providerId !== provider.id) {
    throw new Error("Desktop model does not belong to the selected provider");
  }
  if (!model.supportedProtocols.includes(settings.protocol)) {
    throw new Error("Desktop model does not support the selected protocol");
  }
  const reasoningLevel = resolveReasoningLevel(model, settings.reasoningLevel);
  return { ...settings, reasoningLevel: reasoningLevel.id };
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
