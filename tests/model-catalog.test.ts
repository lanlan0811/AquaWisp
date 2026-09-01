import {
  builtInModelCatalog,
  getBuiltInModel,
  getBuiltInProvider,
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
    const qwen = resolveReasoningLevel(getBuiltInModel("qwen3.8-max"), "max");

    expect(glm.id).toBe("max");
    expect(glm.protocolPatches.responses?.set["reasoning.effort"]).toBe("max");
    expect(deepseek.id).toBe("high");
    expect(deepseek.protocolPatches.chat_completions?.unset).toContain("temperature");
    expect(qwen.id).toBe("xhigh");
    expect(qwen.protocolPatches.chat_completions?.unset).toContain("thinking_budget");
  });

  it("marks only Kimi maximum output as pending live verification", () => {
    const pending = builtInModelCatalog.models
      .filter(({ maxOutputTokensStatus }) => maxOutputTokensStatus === "pending_live_verification")
      .map(({ id }) => id);
    expect(pending).toEqual(["kimi-k3"]);
  });

  it("rejects unknown identifiers", () => {
    expect(() => getBuiltInModel("unknown-model")).toThrow(/Unknown built-in model/);
    expect(() => getBuiltInProvider("unknown-provider")).toThrow(/Unknown built-in provider/);
    expect(() => resolveReasoningLevel(getBuiltInModel("glm-5.3"), "off")).toThrow(
      /does not support reasoning level/,
    );
  });
});
