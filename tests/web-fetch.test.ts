import { WebFetchClient } from "@aquawisp/tools";
import { describe, expect, it } from "vitest";

function response(body: string): Response {
  const encoder = new TextEncoder();
  return new Response(encoder.encode(body), {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

describe("M3 web fetch", () => {
  it("accepts configured protocols, bounds body output, and labels content untrusted", async () => {
    const client = new WebFetchClient({
      allowedProtocols: ["https:"],
      maximumResponseBytes: 4,
      fetchImplementation: () => Promise.resolve(response("abcdef")),
    });

    const result = await client.fetch({ url: "https://example.test/source" });

    expect(result).toMatchObject({ body: "abcd", truncated: true, untrusted: true, status: 200 });
  });

  it("rejects disallowed initial URLs and redirects", async () => {
    const client = new WebFetchClient({
      allowedProtocols: ["https:"],
      maximumResponseBytes: 64,
      fetchImplementation: () => Promise.resolve(response("ok")),
    });

    await expect(client.fetch({ url: "file:///etc/passwd" })).rejects.toThrow("not allowed");
    await expect(client.fetch({ url: "https://example.test" })).resolves.toMatchObject({
      finalUrl: "https://example.test/",
    });
  });
});
