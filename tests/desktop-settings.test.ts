import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DesktopSettingsStore, desktopConfig } from "@aquawisp/desktop";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("M5 desktop settings store", () => {
  it("returns validated defaults, persists non-secret settings, and survives reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-settings-"));
    directories.push(directory);
    const filePath = join(directory, desktopConfig.settings.fileName);
    const defaults = {
      providerId: desktopConfig.settings.defaultProviderId,
      modelId: desktopConfig.settings.defaultModelId,
      protocol: desktopConfig.settings.defaultProtocol,
      reasoningLevel: desktopConfig.settings.defaultReasoningLevel,
      secretName: desktopConfig.settings.defaultSecretName,
      mode: desktopConfig.settings.defaultMode,
    } as const;
    const store = new DesktopSettingsStore({ filePath, defaults });
    expect(await store.get()).toEqual(defaults);

    const saved = await store.set({ ...defaults, reasoningLevel: "medium", mode: "plan" });
    expect(saved).toMatchObject({ reasoningLevel: "high", mode: "plan" });
    const reopened = new DesktopSettingsStore({ filePath, defaults });
    await expect(reopened.get()).resolves.toEqual(saved);
  });

  it("rejects provider/model, protocol, and reasoning mismatches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-settings-invalid-"));
    directories.push(directory);
    const defaults = {
      providerId: "bigmodel",
      modelId: "glm-5.3",
      protocol: "chat_completions" as const,
      reasoningLevel: "max",
      secretName: "provider-bigmodel-api-key",
      mode: "work" as const,
    };
    const store = new DesktopSettingsStore({
      filePath: join(directory, "settings.json"),
      defaults,
    });
    await expect(store.set({ ...defaults, providerId: "deepseek" })).rejects.toThrow(
      "does not belong",
    );
    await expect(
      store.set({
        ...defaults,
        providerId: "moonshot-kimi",
        modelId: "kimi-k3",
        protocol: "responses",
      }),
    ).rejects.toThrow("does not support the selected protocol");
    await expect(store.set({ ...defaults, reasoningLevel: "unsupported" })).rejects.toThrow(
      "does not support reasoning level",
    );
    await expect(store.set({ ...defaults, mode: "full_access" })).rejects.toThrow();
  });

  it("safely downgrades the formerly persisted full-access mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-settings-legacy-mode-"));
    directories.push(directory);
    const filePath = join(directory, "settings.json");
    const defaults = {
      providerId: "bigmodel",
      modelId: "glm-5.3",
      protocol: "chat_completions" as const,
      reasoningLevel: "max",
      secretName: "provider-bigmodel-api-key",
      mode: "work" as const,
    };
    await writeFile(filePath, JSON.stringify({ ...defaults, mode: "full_access" }), "utf8");

    const store = new DesktopSettingsStore({ filePath, defaults });
    await expect(store.get()).resolves.toEqual(defaults);
  });
});
