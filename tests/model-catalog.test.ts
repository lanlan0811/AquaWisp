import {
  builtInModelCatalog,
  getBuiltInModel,
  getBuiltInProvider,
  modelDefinitionSchema,
  resolveReasoningLevel,
} from "@aquawisp/models-catalog";
import { describe, expect, it } from "vitest";

describe("M2 built-in model catalog", () => {
  it("loads four providers and nine unique configured models", () => {
    expect(builtInModelCatalog.providers).toHaveLength(4);
    expect(builtInModelCatalog.models).toHaveLength(9);
    expect(new Set(builtInModelCatalog.models.map(({ id }) => id)).size).toBe(9);
  });

  it("keeps v1 protocol routing aligned with the development plan", () => {
    expect(getBuiltInModel("glm-5.3").supportedProtocols).toEqual([
      "chat_completions",
      "responses",
    ]);
    expect(getBuiltInModel("deepseek-v4-pro").supportedProtocols).toEqual([
      "chat_completions",
      "responses",
    ]);
    expect(getBuiltInModel("kimi-k3").supportedProtocols).toEqual(["chat_completions"]);
    expect(getBuiltInModel("qwen3.8-max").supportedProtocols).toEqual(["chat_completions"]);
  });

  it("resolves provider-specific reasoning aliases to declared patches", () => {
    const glm = resolveReasoningLevel(getBuiltInModel("glm-5.3"), "xhigh");
    const deepseek = resolveReasoningLevel(getBuiltInModel("deepseek-v4-pro"), "medium");
    const deepseekXhigh = resolveReasoningLevel(getBuiltInModel("deepseek-v4-pro"), "xhigh");
    const qwen = resolveReasoningLevel(getBuiltInModel("qwen3.8-max"), "max");

    expect(glm.id).toBe("max");
    expect(glm.protocolPatches.responses?.set["reasoning.effort"]).toBe("max");
    expect(deepseek.id).toBe("high");
    expect(deepseekXhigh.id).toBe("max");
    expect(deepseek.protocolPatches.chat_completions?.unset).toContain("temperature");
    expect(qwen.id).toBe("xhigh");
    expect(qwen.protocolPatches.chat_completions?.unset).toContain("thinking_budget");
  });

  it("records the officially documented Kimi K3 limits and partial continuation patch", () => {
    const pending = builtInModelCatalog.models
      .filter(({ maxOutputTokensStatus }) => maxOutputTokensStatus === "pending_live_verification")
      .map(({ id }) => id);
    const kimi = getBuiltInModel("kimi-k3");

    expect(pending).toEqual([]);
    expect(kimi.contextWindow).toBe(1_048_576);
    expect(kimi.maxOutputTokens).toBe(1_048_576);
    expect(kimi.maxOutputTokensStatus).toBe("official");
    expect(kimi.streamRecovery?.assistantMessagePatches.chat_completions?.set.partial).toBe(true);
    expect(kimi.sourceUrls).toContain("https://platform.kimi.com/docs/guide/kimi-k3-quickstart");
  });

  it("rejects recovery patches that can overwrite assistant identity or content", () => {
    const kimi = getBuiltInModel("kimi-k3");

    expect(() =>
      modelDefinitionSchema.parse({
        ...kimi,
        streamRecovery: {
          assistantMessagePatches: {
            chat_completions: { set: { content: "replacement" }, unset: [] },
          },
        },
      }),
    ).toThrow(/cannot change assistant role or content/);
  });

  it("rejects unknown identifiers", () => {
    expect(() => getBuiltInModel("unknown-model")).toThrow(/Unknown built-in model/);
    expect(() => getBuiltInProvider("unknown-provider")).toThrow(/Unknown built-in provider/);
    expect(() => resolveReasoningLevel(getBuiltInModel("glm-5.3"), "off")).toThrow(
      /does not support reasoning level/,
    );
  });
});
