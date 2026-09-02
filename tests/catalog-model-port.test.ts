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
      maximumRecoveryAttempts: 1,
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
        {
          runId: "run-1",
          cycle: 1,
          userInput: "你好",
          observations: [],
          contextItems: [
            {
              id: "system-1",
              kind: "system",
              content: "系统规则",
              createdAt: "2026-09-02T00:00:00.000Z",
              provenanceEventIds: [],
            },
            {
              id: "user-1",
              kind: "user",
              content: "你好",
              createdAt: "2026-09-02T00:00:00.000Z",
              provenanceEventIds: [],
            },
          ],
        },
        new AbortController().signal,
      ),
    );

    expect(requestedUrl).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(authorization).toBe("Bearer fixture-key");
    expect(requestedBody).toMatchObject({
      model: "glm-5.3",
      stream: true,
      messages: [
        { role: "system", content: "系统规则" },
        { role: "user", content: "你好" },
      ],
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
          maximumRecoveryAttempts: 1,
        }),
    ).toThrow("does not belong");
  });

  it("continues an interrupted stream from the emitted assistant prefix and exposes recovery", async () => {
    const bodies: unknown[] = [];
    let requestNumber = 0;
    const port = new CatalogModelPort({
      providerId: "moonshot-kimi",
      modelId: "kimi-k3",
      protocol: "chat_completions",
      reasoningLevel: "max",
      apiKey: "fixture-key",
      maximumRecoveryAttempts: 1,
      fetchImplementation: (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
        bodies.push(JSON.parse(init.body) as unknown);
        requestNumber += 1;
        return Promise.resolve(
          requestNumber === 1
            ? sseResponse(['data: {"choices":[{"delta":{"content":"未完"}}]}\n\n'])
            : sseResponse([
                'data: {"choices":[{"delta":{"content":"成"},"finish_reason":"stop"}]}\n\n',
                "data: [DONE]\n\n",
              ]),
        );
      },
    });

    const signals = await collect(
      port.reason(
        {
          runId: "run-recovery",
          cycle: 1,
          userInput: "继续测试",
          observations: [],
          contextItems: [
            {
              id: "user-recovery",
              kind: "user",
              content: "继续测试",
              createdAt: "2026-09-02T00:00:00.000Z",
              provenanceEventIds: [],
            },
          ],
        },
        new AbortController().signal,
      ),
    );

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({
      messages: [
        { role: "user", content: "继续测试" },
        { role: "assistant", content: "未完", partial: true },
      ],
    });
    expect(signals).toEqual([
      { kind: "text_delta", delta: "未完" },
      { kind: "stream_recovery", recoveryAttempt: 1, priorEventCount: 1 },
      { kind: "text_delta", delta: "成" },
      { kind: "decision", decision: { kind: "final", content: "未完成" } },
    ]);
  });
});
