import {
  ModelStreamInterruptedError,
  ModelStreamRecoveryExhaustedError,
  OpenAICompatibleClient,
  streamWithRecovery,
} from "@aquawisp/model";
import { validateCustomProviderConnection } from "@aquawisp/models-catalog";
import { describe, expect, it } from "vitest";

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const item of iterable) {
    output.push(item);
  }
  return output;
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function requestJsonBody(init?: RequestInit): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON string request body");
  }
  return JSON.parse(init.body) as unknown;
}

describe("M2 OpenAI-compatible streaming client", () => {
  it("normalizes and parses a Chat Completions stream across chunk boundaries", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    const mockFetch: typeof fetch = (input, init) => {
      requestedUrl = requestUrl(input);
      requestedBody = requestJsonBody(init);
      return Promise.resolve(
        sseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"思考"},"finish_reason":null}]}\r',
          '\n\r\ndata: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    };
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      protocol: "chat_completions",
      fetchImplementation: mockFetch,
    });

    const events = await collect(
      client.stream({ model: "glm-5.3", reasoningLevel: "high", body: { messages: [] } }),
    );

    expect(requestedUrl).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(requestedBody).toMatchObject({
      model: "glm-5.3",
      stream: true,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
    expect(events).toEqual([
      { kind: "reasoning_delta", delta: "思考", sequence: 0 },
      { kind: "text_delta", delta: "完成", sequence: 1 },
      { kind: "completed", finishReason: "stop", sequence: 2 },
    ]);
  });

  it("parses semantic Responses API events", async () => {
    let requestedBody: unknown;
    const mockFetch: typeof fetch = (_input, init) => {
      requestedBody = requestJsonBody(init);
      return Promise.resolve(
        sseResponse([
          'event: response.reasoning_text.delta\ndata: {"type":"response.reasoning_text.delta","delta":"R"}\n\n',
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"T"}\n\n',
          'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}\n\n',
        ]),
      );
    };
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      protocol: "responses",
      fetchImplementation: mockFetch,
    });

    const events = await collect(
      client.stream({ model: "deepseek-v4-pro", reasoningLevel: "max", body: { input: "x" } }),
    );

    expect(requestedBody).toMatchObject({
      model: "deepseek-v4-pro",
      stream: true,
      reasoning: { effort: "max" },
    });
    expect(events).toEqual([
      { kind: "reasoning_delta", delta: "R", sequence: 0 },
      { kind: "text_delta", delta: "T", sequence: 1 },
      { kind: "usage", usage: { input_tokens: 1, output_tokens: 2 }, sequence: 2 },
      { kind: "completed", finishReason: "completed", sequence: 3 },
    ]);
  });

  it("distinguishes an interrupted stream from protocol completion", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      baseUrl: "https://api.moonshot.cn/v1",
      protocol: "chat_completions",
      fetchImplementation: () =>
        Promise.resolve(sseResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])),
    });

    await expect(
      collect(client.stream({ model: "kimi-k3", body: { messages: [] } })),
    ).rejects.toMatchObject({
      name: ModelStreamInterruptedError.name,
      emittedEvents: 1,
    });
  });

  it("returns bounded HTTP error details", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      protocol: "chat_completions",
      maximumErrorBodyBytes: 8,
      fetchImplementation: () => Promise.resolve(new Response("0123456789", { status: 401 })),
    });

    await expect(
      collect(client.stream({ model: "deepseek-v4-pro", body: { messages: [] } })),
    ).rejects.toEqual(expect.objectContaining({ status: 401, responseBody: "01234567" }));
  });

  it("uses an explicitly selected custom-provider protocol without a built-in catalog lookup", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    const custom = validateCustomProviderConnection({
      providerId: "custom-provider",
      providerName: "Custom Provider",
      baseUrl: "http://localhost:4010/v1",
      protocol: "chat_completions",
      model: {
        id: "custom-model",
        name: "Custom Model",
        providerId: "custom-provider",
        contextWindow: 32000,
        maxOutputTokens: 4096,
        maxOutputTokensStatus: "pending_live_verification",
        supportedProtocols: ["chat_completions"],
        supportsTools: true,
        supportsStructuredOutput: false,
        inputModalities: ["text"],
        reasoning: {
          defaultLevel: "standard",
          aliases: {},
          levels: [
            {
              id: "standard",
              rank: 10,
              protocolPatches: {
                chat_completions: { set: { reasoning_effort: "standard" }, unset: [] },
              },
            },
          ],
        },
        sourceUrls: ["http://localhost:4010/v1"],
      },
    });
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      baseUrl: custom.baseUrl,
      protocol: custom.protocol,
      fetchImplementation: (input, init) => {
        requestedUrl = requestUrl(input);
        requestedBody = requestJsonBody(init);
        return Promise.resolve(sseResponse(["data: [DONE]\n\n"]));
      },
    });

    const events = await collect(client.stream({ model: custom.model, body: { messages: [] } }));

    expect(requestedUrl).toBe("http://localhost:4010/v1/chat/completions");
    expect(requestedBody).toMatchObject({
      model: "custom-model",
      stream: true,
      reasoning_effort: "standard",
    });
    expect(events).toEqual([{ kind: "completed", finishReason: null, sequence: 0 }]);
  });

  it("continues an interrupted stream only through an explicit recovery callback", async () => {
    let requestNumber = 0;
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      baseUrl: "https://api.moonshot.cn/v1",
      protocol: "chat_completions",
      fetchImplementation: () => {
        requestNumber += 1;
        return Promise.resolve(
          requestNumber === 1
            ? sseResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])
            : sseResponse([
                'data: {"choices":[{"delta":{"content":" resumed"},"finish_reason":"stop"}]}\n\n',
                "data: [DONE]\n\n",
              ]),
        );
      },
    });
    const resume = ({
      emittedEvents,
      recoveryAttempt,
    }: Parameters<Parameters<typeof streamWithRecovery>[0]["resume"]>[0]) => {
      expect(emittedEvents).toEqual([{ kind: "text_delta", delta: "partial", sequence: 0 }]);
      expect(recoveryAttempt).toBe(1);
      return Promise.resolve({ model: "kimi-k3", body: { messages: [], continuation: "partial" } });
    };

    const events = await collect(
      streamWithRecovery({
        client,
        request: { model: "kimi-k3", body: { messages: [] } },
        maximumRecoveryAttempts: 1,
        resume,
      }),
    );

    expect(events).toEqual([
      { kind: "text_delta", delta: "partial", sequence: 0 },
      { kind: "text_delta", delta: " resumed", sequence: 1 },
      { kind: "completed", finishReason: "stop", sequence: 2 },
    ]);
    expect(requestNumber).toBe(2);
  });

  it("reports an exhausted recovery budget instead of blindly retrying", async () => {
    const client = new OpenAICompatibleClient({
      apiKey: "test-key",
      baseUrl: "https://api.moonshot.cn/v1",
      protocol: "chat_completions",
      fetchImplementation: () => Promise.resolve(sseResponse([])),
    });

    await expect(
      collect(
        streamWithRecovery({
          client,
          request: { model: "kimi-k3", body: { messages: [] } },
          maximumRecoveryAttempts: 0,
          resume: () => Promise.resolve({ model: "kimi-k3", body: { messages: [] } }),
        }),
      ),
    ).rejects.toMatchObject({
      name: ModelStreamRecoveryExhaustedError.name,
      recoveryAttempts: 0,
    });
  });
});
