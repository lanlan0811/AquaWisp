import { resolveDesktopRunSelection } from "@aquawisp/desktop";
import { describe, expect, it } from "vitest";

const settings = {
  providerId: "bigmodel",
  modelId: "glm-5.3",
  protocol: "chat_completions" as const,
  reasoningLevel: "max",
  secretName: "provider-bigmodel-api-key",
  mode: "work" as const,
};

describe("M5 per-session model selection", () => {
  it("normalizes a catalog-declared reasoning alias", () => {
    expect(
      resolveDesktopRunSelection(settings, { modelId: "glm-5.2", reasoningLevel: "low" }),
    ).toEqual({
      providerId: "bigmodel",
      modelId: "glm-5.2",
      protocol: "chat_completions",
      reasoningLevel: "high",
    });
  });

  it("rejects cross-provider models and unsupported reasoning levels", () => {
    expect(() =>
      resolveDesktopRunSelection(settings, {
        modelId: "deepseek-v4-pro",
        reasoningLevel: "high",
      }),
    ).toThrow("does not belong to the configured provider");
    expect(() =>
      resolveDesktopRunSelection(settings, {
        modelId: "glm-5.3",
        reasoningLevel: "unsupported",
      }),
    ).toThrow("does not support reasoning level");
  });
});
