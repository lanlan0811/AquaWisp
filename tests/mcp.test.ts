import {
  builtInMcpRegistry,
  McpStdioClientHost,
  parseMcpRegistry,
  type McpRegistry,
} from "@aquawisp/tools";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repositoryRoot, "tests", "fixtures", "mcp-echo-server.mjs");

function testRegistry(overrides: Partial<McpRegistry["defaults"]> = {}): McpRegistry {
  return parseMcpRegistry({
    schemaVersion: 1,
    client: { name: "aquawisp-test", version: "1.0.0" },
    defaults: {
      requestTimeoutMs: 5_000,
      maxObservationBytes: 1_024,
      maxBufferBytes: 1_048_576,
      maxStderrBytes: 4_096,
      ...overrides,
    },
    servers: [
      {
        id: "fixture",
        name: "Fixture MCP",
        command: process.execPath,
        args: [fixturePath],
        cwd: ".",
        environment: {},
        allowedTools: ["echo", "large", "slow"],
        enabled: true,
      },
    ],
  });
}

function firstServer(registry: McpRegistry): McpRegistry["servers"][number] {
  const server = registry.servers[0];
  if (server === undefined) throw new Error("Test MCP registry requires one server");
  return server;
}

describe("M8 stdio MCP client", () => {
  it("ships a disabled-by-default validated registry", () => {
    expect(builtInMcpRegistry.schemaVersion).toBe(1);
    expect(builtInMcpRegistry.servers).toEqual([]);
    const registry = testRegistry();
    const server = firstServer(registry);
    expect(() =>
      parseMcpRegistry({
        ...registry,
        servers: [server, server],
      }),
    ).toThrow("unique");
  });

  it("filters discovery, enforces the allowlist, and labels results untrusted", async () => {
    const host = await McpStdioClientHost.create({
      workspaceRoot: repositoryRoot,
      registry: testRegistry(),
    });
    try {
      expect((await host.listTools("fixture")).map(({ name }) => name)).toEqual([
        "echo",
        "large",
        "slow",
      ]);
      const observation = await host.callTool({
        serverId: "fixture",
        toolName: "echo",
        arguments: { value: "沧渡" },
      });
      expect(observation).toMatchObject({
        source: "mcp:fixture/echo",
        trust: "untrusted",
        isError: false,
        truncated: false,
      });
      expect(JSON.stringify(observation.content)).toContain("沧渡");
      await expect(host.callTool({ serverId: "fixture", toolName: "hidden" })).rejects.toThrow(
        "not allowlisted",
      );
    } finally {
      await host.close();
    }
  });

  it("caps large observations and rejects a cwd outside the workspace", async () => {
    const host = await McpStdioClientHost.create({
      workspaceRoot: repositoryRoot,
      registry: testRegistry({ maxObservationBytes: 256 }),
    });
    try {
      const observation = await host.callTool({ serverId: "fixture", toolName: "large" });
      expect(observation.truncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(observation), "utf8")).toBeLessThanOrEqual(256);
    } finally {
      await host.close();
    }

    const registry = testRegistry();
    const outsideRegistry = parseMcpRegistry({
      ...registry,
      servers: [{ ...firstServer(registry), cwd: ".." }],
    });
    const outsideHost = await McpStdioClientHost.create({
      workspaceRoot: repositoryRoot,
      registry: outsideRegistry,
    });
    await expect(outsideHost.listTools("fixture")).rejects.toThrow("outside workspace");
    await outsideHost.close();
  });

  it("applies the configured request timeout", async () => {
    const host = await McpStdioClientHost.create({
      workspaceRoot: repositoryRoot,
      registry: testRegistry({ requestTimeoutMs: 25 }),
    });
    try {
      await expect(host.callTool({ serverId: "fixture", toolName: "slow" })).rejects.toThrow();
    } finally {
      await host.close();
    }
  });
});
