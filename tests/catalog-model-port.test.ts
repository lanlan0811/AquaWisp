import type { ModelSignal } from "@aquawisp/contracts";
import { CatalogModelPort } from "@aquawisp/runtime";
import { describe, expect, it } from "vitest";

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

async function collect(iterable: AsyncIterable<ModelSignal>): Promise<ModelSignal[]> {
  const signals: ModelSignal[] = [];
  for await (const signal of iterable) signals.push(signal);
  return signals;
}

describe("M2 catalog-backed runtime model port", () => {
  it("routes the selected model and reasoning level into a streaming chat request", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    let authorization = "";
    const port = new CatalogModelPort({
      providerId: "bigmodel",
      modelId: "glm-5.3",
      protocol: "chat_completions",
      reasoningLevel: "max",
      apiKey: "fixture-key",
      fetchImplementation: (input, init) => {
        const requestInit = init ?? {};
        requestedUrl = input instanceof Request ? input.url : input.toString();
        if (typeof requestInit.body !== "string") throw new Error("Expected a JSON request body");
        requestedBody = JSON.parse(requestInit.body) as unknown;
        authorization = new Headers(requestInit.headers).get("authorization") ?? "";
        return Promise.resolve(
          sseResponse([
            'data: {"choices":[{"delta":{"content":"真实"},"finish_reason":null}]}\n\n',
            'data: {"choices":[{"delta":{"content":"对话"},"finish_reason":"stop"}]}\n\n',
            "data: [DONE]\n\n",
          ]),
        );
      },
    });

    const signals = await collect(
      port.reason(
        { runId: "run-1", cycle: 1, userInput: "你好", observations: [] },
        new AbortController().signal,
      ),
    );

    expect(requestedUrl).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(authorization).toBe("Bearer fixture-key");
    expect(requestedBody).toMatchObject({
      model: "glm-5.3",
      stream: true,
      messages: [{ role: "user", content: "你好" }],
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
    expect(signals).toEqual([
      { kind: "text_delta", delta: "真实" },
      { kind: "text_delta", delta: "对话" },
      { kind: "decision", decision: { kind: "final", content: "真实对话" } },
    ]);
  });

  it("rejects provider/model pairs that do not belong together", () => {
    expect(
      () =>
        new CatalogModelPort({
          providerId: "deepseek",
          modelId: "glm-5.3",
          protocol: "chat_completions",
          reasoningLevel: "max",
          apiKey: "fixture-key",
        }),
    ).toThrow("does not belong");
  });
});
