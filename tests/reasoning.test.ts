import { normalizeReasoningRequest } from "@aquawisp/model";
import { describe, expect, it } from "vitest";

describe("M2 reasoning request normalization", () => {
  it("applies GLM forced thinking to Chat Completions and Responses", () => {
    const chat = normalizeReasoningRequest({
      model: "glm-5.3",
      protocol: "chat_completions",
      requestedLevel: "low",
      request: { model: "glm-5.3", messages: [] },
    });
    const responses = normalizeReasoningRequest({
      model: "glm-5.3",
      protocol: "responses",
      requestedLevel: "xhigh",
      request: { model: "glm-5.3", input: "test" },
    });

    expect(chat.request).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
    expect(responses.canonicalLevel).toBe("max");
    expect(responses.request).toMatchObject({ reasoning: { effort: "max" } });
  });

  it("removes unsupported DeepSeek sampling parameters in both protocols", () => {
    const base = { temperature: 0.2, top_p: 0.8, presence_penalty: 1, frequency_penalty: 1 };
    const chat = normalizeReasoningRequest({
      model: "deepseek-v4-pro",
      protocol: "chat_completions",
      requestedLevel: "medium",
      request: base,
    });
    const responses = normalizeReasoningRequest({
      model: "deepseek-v4-pro",
      protocol: "responses",
      requestedLevel: "max",
      request: base,
    });

    expect(chat.canonicalLevel).toBe("high");
    expect(chat.request).not.toHaveProperty("temperature");
    expect(chat.request).not.toHaveProperty("top_p");
    expect(chat.request).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
    expect(responses.request).not.toHaveProperty("temperature");
    expect(responses.request).not.toHaveProperty("top_p");
    expect(responses.request).toMatchObject({ reasoning: { effort: "max" } });
    expect(base).toHaveProperty("temperature", 0.2);
  });

  it("keeps Kimi on top-level reasoning_effort without a thinking toggle", () => {
    const normalized = normalizeReasoningRequest({
      model: "kimi-k3",
      protocol: "chat_completions",
      requestedLevel: "high",
      request: { thinking: { type: "disabled" }, messages: [] },
    });

    expect(normalized.request).toEqual({ messages: [], reasoning_effort: "high" });
  });

  it("maps Qwen aliases and removes conflicting legacy controls", () => {
    const maxAlias = normalizeReasoningRequest({
      model: "qwen3.8-max",
      protocol: "chat_completions",
      requestedLevel: "max",
      request: { enable_thinking: true, thinking_budget: 4096 },
    });
    const nativeLevel = normalizeReasoningRequest({
      model: "qwen3.8-max",
      protocol: "chat_completions",
      requestedLevel: "xhigh",
      request: {},
    });

    expect(maxAlias.canonicalLevel).toBe("xhigh");
    expect(maxAlias.request).toEqual({ reasoning_effort: "xhigh" });
    expect(maxAlias.revision).toBe(nativeLevel.revision);
  });

  it("rejects unsupported protocol and level combinations", () => {
    expect(() =>
      normalizeReasoningRequest({
        model: "qwen3.8-max",
        protocol: "responses",
        request: {},
      }),
    ).toThrow(/does not support protocol/);
    expect(() =>
      normalizeReasoningRequest({
        model: "glm-5.3",
        protocol: "chat_completions",
        requestedLevel: "off",
        request: {},
      }),
    ).toThrow(/does not support reasoning level/);
  });
});
