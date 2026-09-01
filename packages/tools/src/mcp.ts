import { realpath, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { Client, type Tool } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";

import registrySource from "./mcp-registry.data.json" with { type: "json" };

const environmentNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

const mcpServerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    cwd: z.string().min(1),
    environment: z.record(environmentNameSchema, environmentNameSchema),
    allowedTools: z.array(z.string().min(1)),
    enabled: z.boolean(),
  })
  .strict()
  .refine(({ allowedTools }) => new Set(allowedTools).size === allowedTools.length, {
    message: "MCP allowedTools entries must be unique",
  });

const mcpRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    client: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
    defaults: z
      .object({
        requestTimeoutMs: z.number().int().positive().max(300_000),
        maxObservationBytes: z.number().int().min(256).max(10_485_760),
        maxBufferBytes: z.number().int().positive().max(10_485_760),
        maxStderrBytes: z.number().int().positive().max(1_048_576),
      })
      .strict(),
    servers: z.array(mcpServerSchema),
  })
  .strict()
  .refine(({ servers }) => new Set(servers.map(({ id }) => id)).size === servers.length, {
    message: "MCP server IDs must be unique",
  });

export type McpRegistry = z.infer<typeof mcpRegistrySchema>;
export type McpServerDefinition = z.infer<typeof mcpServerSchema>;
export const builtInMcpRegistry: McpRegistry = mcpRegistrySchema.parse(registrySource);

export interface McpToolObservation {
  readonly source: string;
  readonly trust: "untrusted";
  readonly isError: boolean;
  readonly truncated: boolean;
  readonly content: unknown;
  readonly structuredContent?: unknown;
}

interface McpConnection {
  readonly client: Client;
  readonly stderr: StderrCollector;
}

export async function loadMcpRegistry(path: string): Promise<McpRegistry> {
  return parseMcpRegistry(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export function parseMcpRegistry(value: unknown): McpRegistry {
  return mcpRegistrySchema.parse(value);
}

export class McpStdioClientHost {
  readonly #workspaceRoot: string;
  readonly #registry: McpRegistry;
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #connections = new Map<string, Promise<McpConnection>>();

  private constructor(
    workspaceRoot: string,
    registry: McpRegistry,
    environment: Readonly<Record<string, string | undefined>>,
  ) {
    this.#workspaceRoot = workspaceRoot;
    this.#registry = registry;
    this.#environment = environment;
  }

  static async create(options: {
    readonly workspaceRoot: string;
    readonly registry: McpRegistry;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  }): Promise<McpStdioClientHost> {
    return new McpStdioClientHost(
      await realpath(options.workspaceRoot),
      options.registry,
      options.environment ?? process.env,
    );
  }

  async listTools(serverId: string): Promise<readonly Tool[]> {
    const server = this.#server(serverId);
    const { client } = await this.#connection(server);
    const result = await client.listTools(undefined, {
      timeout: this.#registry.defaults.requestTimeoutMs,
      maxTotalTimeout: this.#registry.defaults.requestTimeoutMs,
    });
    const allowed = new Set(server.allowedTools);
    return result.tools.filter(({ name }) => allowed.has(name));
  }

  async callTool(options: {
    readonly serverId: string;
    readonly toolName: string;
    readonly arguments?: Record<string, unknown>;
    readonly signal?: AbortSignal;
  }): Promise<McpToolObservation> {
    const server = this.#server(options.serverId);
    if (!server.allowedTools.includes(options.toolName)) {
      throw new Error(`MCP tool is not allowlisted: ${options.serverId}/${options.toolName}`);
    }
    const { client } = await this.#connection(server);
    const result = await client.callTool(
      {
        name: options.toolName,
        ...(options.arguments === undefined ? {} : { arguments: options.arguments }),
      },
      {
        timeout: this.#registry.defaults.requestTimeoutMs,
        maxTotalTimeout: this.#registry.defaults.requestTimeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    return limitObservation(
      {
        source: `mcp:${server.id}/${options.toolName}`,
        trust: "untrusted",
        isError: result.isError === true,
        truncated: false,
        content: result.content,
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: result.structuredContent }),
      },
      this.#registry.defaults.maxObservationBytes,
    );
  }

  async diagnostics(serverId: string): Promise<string> {
    const pending = this.#connections.get(serverId);
    if (pending === undefined) return "";
    return (await pending).stderr.text();
  }

  async close(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.allSettled(
      connections.map(async (connection) => {
        const { client } = await connection;
        await client.close();
      }),
    );
  }

  #server(serverId: string): McpServerDefinition {
    const server = this.#registry.servers.find(({ id }) => id === serverId);
    if (!server?.enabled) {
      throw new Error(`MCP server is not enabled: ${serverId}`);
    }
    return server;
  }

  #connection(server: McpServerDefinition): Promise<McpConnection> {
    const existing = this.#connections.get(server.id);
    if (existing !== undefined) return existing;
    const connection = this.#connect(server).catch((error: unknown) => {
      this.#connections.delete(server.id);
      throw error;
    });
    this.#connections.set(server.id, connection);
    return connection;
  }

  async #connect(server: McpServerDefinition): Promise<McpConnection> {
    const cwd = await realpath(resolve(this.#workspaceRoot, server.cwd));
    if (!isInside(this.#workspaceRoot, cwd)) {
      throw new Error(`MCP server cwd is outside workspace: ${server.id}`);
    }
    const environment = getDefaultEnvironment();
    for (const [targetName, sourceName] of Object.entries(server.environment)) {
      const value = this.#environment[sourceName];
      if (value === undefined) {
        throw new Error(`MCP environment source is missing: ${sourceName}`);
      }
      environment[targetName] = value;
    }

    const transport = new StdioClientTransport({
      command: server.command,
      args: [...server.args],
      cwd,
      env: environment,
      stderr: "pipe",
      maxBufferSize: this.#registry.defaults.maxBufferBytes,
    });
    const stderr = new StderrCollector(this.#registry.defaults.maxStderrBytes);
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderr.append(chunk);
    });
    const client = new Client(this.#registry.client);
    try {
      await client.connect(transport, {
        timeout: this.#registry.defaults.requestTimeoutMs,
        maxTotalTimeout: this.#registry.defaults.requestTimeoutMs,
      });
    } catch (error) {
      await transport.close();
      const diagnostics = stderr.text();
      throw new Error(
        diagnostics === ""
          ? `MCP server connection failed: ${server.id}`
          : `MCP server connection failed: ${server.id}; stderr: ${diagnostics}`,
        { cause: error },
      );
    }
    return { client, stderr };
  }
}

class StderrCollector {
  readonly #limit: number;
  #value = "";

  constructor(limit: number) {
    this.#limit = limit;
  }

  append(chunk: Buffer | string): void {
    if (Buffer.byteLength(this.#value, "utf8") >= this.#limit) return;
    const remaining = this.#limit - Buffer.byteLength(this.#value, "utf8");
    this.#value += Buffer.from(chunk).subarray(0, remaining).toString("utf8");
  }

  text(): string {
    return this.#value.trim();
  }
}

function limitObservation(observation: McpToolObservation, maxBytes: number): McpToolObservation {
  const serialized = JSON.stringify(observation);
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) return observation;
  const prefix = Buffer.from(serialized, "utf8");
  let previewBytes = maxBytes;
  const base = {
    source: observation.source,
    trust: "untrusted" as const,
    isError: observation.isError,
    truncated: true as const,
  };
  while (previewBytes > 0) {
    const candidate: McpToolObservation = {
      ...base,
      content: prefix.subarray(0, previewBytes).toString("utf8"),
    };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= maxBytes) return candidate;
    previewBytes = Math.floor(previewBytes * 0.75);
  }
  return { ...base, content: "" };
}

function isInside(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}
