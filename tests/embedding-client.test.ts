import {
  EmbeddingHttpError,
  OpenAICompatibleEmbeddingProvider,
  knowledgeBaseConfig,
} from "@aquawisp/kb";
import { describe, expect, it, vi } from "vitest";

describe("M4 OpenAI-compatible embedding provider", () => {
  it("sends a bounded authenticated embeddings request and validates dimensions", async () => {
    const requests: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetchImplementation: typeof fetch = (input, init) => {
      requests.push({ url: requestUrl(input), ...(init === undefined ? {} : { init }) });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: [0.25, 0.75] }],
            model: "fixture-embedding",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "fixture-embedding",
      dimensions: 2,
      apiKey: "fixture-secret",
      includeDimensions: true,
      fetchImplementation,
    });

    await expect(provider.embed("混合检索")).resolves.toEqual([0.25, 0.75]);
    expect(requests[0]?.url).toBe("http://localhost:11434/v1/embeddings");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer fixture-secret",
      "content-type": "application/json",
    });
    const body = requests[0]?.init?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON string request body");
    expect(JSON.parse(body)).toEqual({
      model: "fixture-embedding",
      input: "混合检索",
      encoding_format: "float",
      dimensions: 2,
    });
  });

  it("supports keyless local providers and rejects insecure remote endpoints", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), { status: 200 }),
      ),
    );
    const local = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "http://127.0.0.1:8080/v1/",
      model: "local-model",
      dimensions: 1,
      fetchImplementation,
    });
    await local.embed("local");
    expect(fetchImplementation.mock.calls[0]?.[1]?.headers).not.toHaveProperty("authorization");
    expect(
      () =>
        new OpenAICompatibleEmbeddingProvider({
          baseUrl: "http://example.test/v1/",
          model: "unsafe",
          dimensions: 1,
        }),
    ).toThrow("must use HTTPS");
    expect(
      () =>
        new OpenAICompatibleEmbeddingProvider({
          baseUrl: "https://example.test/v1/",
          requestPath: "../outside",
          model: "unsafe-path",
          dimensions: 1,
        }),
    ).toThrow("safe relative path");
  });

  it("surfaces bounded HTTP failures and malformed vectors", async () => {
    const failed = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://example.test/v1/",
      model: "failure",
      dimensions: 2,
      fetchImplementation: () =>
        Promise.resolve(new Response("provider unavailable", { status: 503 })),
    });
    const error = await failed.embed("query").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(EmbeddingHttpError);
    expect(error).toMatchObject({ status: 503, responseBody: "provider unavailable" });

    const malformed = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://example.test/v1/",
      model: "malformed",
      dimensions: 2,
      fetchImplementation: () =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }), { status: 200 }),
        ),
    });
    await expect(malformed.embed("query")).rejects.toThrow("dimensions do not match");
  });

  it("rejects empty and oversized inputs before network access", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://example.test/v1/",
      model: "fixture",
      dimensions: 1,
      fetchImplementation,
    });
    await expect(provider.embed(" ")).rejects.toThrow("cannot be empty");
    await expect(
      provider.embed("x".repeat(knowledgeBaseConfig.indexing.maximumEmbeddingInputCharacters + 1)),
    ).rejects.toThrow("character limit");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
