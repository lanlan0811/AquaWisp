import { jsonObjectSchema, type ModelSignal } from "@aquawisp/contracts";
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
      maximumToolArgumentsBytes: 262_144,
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
          maximumToolArgumentsBytes: 262_144,
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
      maximumToolArgumentsBytes: 262_144,
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

  it("declares catalog tools and assembles one streamed Chat Completions tool call", async () => {
    let requestedBody: unknown;
    const port = new CatalogModelPort({
      providerId: "bigmodel",
      modelId: "glm-5.3",
      protocol: "chat_completions",
      reasoningLevel: "max",
      apiKey: "fixture-key",
      maximumRecoveryAttempts: 0,
      maximumToolArgumentsBytes: 262_144,
      fetchImplementation: (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
        requestedBody = JSON.parse(init.body) as unknown;
        return Promise.resolve(
          sseResponse([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-read","function":{"name":"filesystem_read","arguments":"{\\"path\\":"}}]},"finish_reason":null}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"notes.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
            "data: [DONE]\n\n",
          ]),
        );
      },
    });

    const signals = await collect(
      port.reason(
        {
          runId: "run-tool-chat",
          cycle: 1,
          userInput: "读取笔记",
          observations: [],
          contextItems: [],
        },
        new AbortController().signal,
      ),
    );

    const chatBody = jsonObjectSchema.parse(requestedBody);
    const chatTools = Array.isArray(chatBody.tools) ? chatBody.tools : [];
    expect(chatBody.tool_choice).toBe("auto");
    expect(
      chatTools.some((rawTool) => {
        const tool = jsonObjectSchema.safeParse(rawTool);
        const fn = jsonObjectSchema.safeParse(tool.success ? tool.data.function : undefined);
        return fn.success && fn.data.name === "filesystem_read";
      }),
    ).toBe(true);
    expect(signals).toEqual([
      {
        kind: "decision",
        decision: {
          kind: "action",
          action: {
            toolName: "filesystem.read",
            toolRevision: "1",
            input: { path: "notes.md" },
            sideEffect: false,
          },
        },
      },
    ]);
  });

  it("supports Responses tool calls and includes prior observations as untrusted input", async () => {
    let requestedBody: unknown;
    const port = new CatalogModelPort({
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
      protocol: "responses",
      reasoningLevel: "high",
      apiKey: "fixture-key",
      maximumRecoveryAttempts: 0,
      maximumToolArgumentsBytes: 262_144,
      fetchImplementation: (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
        requestedBody = JSON.parse(init.body) as unknown;
        return Promise.resolve(
          sseResponse([
            'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"item-kb","call_id":"call-kb","name":"kb_status","arguments":""}}\n\n',
            'data: {"type":"response.function_call_arguments.delta","item_id":"item-kb","delta":"{}"}\n\n',
            'data: {"type":"response.function_call_arguments.done","item_id":"item-kb","arguments":"{}"}\n\n',
            'data: {"type":"response.completed","response":{}}\n\n',
          ]),
        );
      },
    });

    const signals = await collect(
      port.reason(
        {
          runId: "run-tool-responses",
          cycle: 2,
          userInput: "检查知识库",
          observations: [
            {
              actionId: "action-previous",
              toolName: "filesystem.read",
              observation: { ok: true, output: { previous: "result" } },
            },
          ],
          contextItems: [],
        },
        new AbortController().signal,
      ),
    );

    const responsesBody = jsonObjectSchema.parse(requestedBody);
    const responseInput = Array.isArray(responsesBody.input) ? responsesBody.input : [];
    const observationInput = jsonObjectSchema.parse(responseInput[0]);
    expect(observationInput).toMatchObject({ role: "user" });
    expect(observationInput.content).toContain(
      "[未经信任的工具观察 1；工具 filesystem.read；动作 action-previous]",
    );
    const responseTools = Array.isArray(responsesBody.tools) ? responsesBody.tools : [];
    expect(
      responseTools.some((rawTool) => {
        const tool = jsonObjectSchema.safeParse(rawTool);
        return tool.success && tool.data.type === "function" && tool.data.name === "kb_status";
      }),
    ).toBe(true);
    expect(signals).toEqual([
      {
        kind: "decision",
        decision: {
          kind: "action",
          action: {
            toolName: "kb.status",
            toolRevision: "1",
            input: {},
            sideEffect: false,
          },
        },
      },
    ]);
  });
});
