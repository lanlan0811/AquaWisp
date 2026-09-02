import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  entityIdSchema,
  runtimeRpcEventSchema,
  runtimeRpcRequestSchema,
  runtimeRpcResponseSchema,
  type RuntimeRpcEvent,
  type RuntimeRpcRequest,
  type RuntimeRpcResponse,
} from "@aquawisp/contracts";
import { getBuiltInModel } from "@aquawisp/models-catalog";

import { CatalogModelPort } from "./catalog-model-port.js";
import { PersistentConversationContext } from "./conversation-context.js";
import { SqliteEventStore } from "./event-store.js";
import type { ModelPort } from "./ports.js";
import {
  BasicOutputVerifier,
  RandomIdGenerator,
  RejectUnexpectedActionExecutor,
  RejectUnexpectedActionPolicy,
  SystemClock,
} from "./production-ports.js";
import { RunEngine } from "./run-engine.js";
import { runtimeHostConfig } from "./runtime-host-config.js";
import type { RuntimeContextConfig } from "./runtime-host-config.js";

export interface RuntimeStdioHostOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly handleRequest?: RuntimeRpcHandler;
  readonly onShutdown?: () => void;
}

export type RuntimeRpcHandler = (
  request: RuntimeRpcRequest,
) => RuntimeRpcResponse | Promise<RuntimeRpcResponse>;

type RuntimeRunStartRequest = Extract<RuntimeRpcRequest, { method: "runtime.run.start" }>;

interface ActiveRuntimeRun {
  readonly requestId: string;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  readonly markSettled: () => void;
  runId?: string;
}

export interface RuntimeRunServiceOptions {
  readonly workingDirectory: string;
  readonly onEvent: (event: RuntimeRpcEvent) => void;
  readonly createModel?: (params: RuntimeRunStartRequest["params"]) => ModelPort;
  readonly contextConfig?: RuntimeContextConfig;
  readonly promptBundlePath?: string;
}

export class RuntimeRunService {
  readonly #store: SqliteEventStore;
  readonly #workingDirectory: string;
  readonly #onEvent: RuntimeRunServiceOptions["onEvent"];
  readonly #createModel: NonNullable<RuntimeRunServiceOptions["createModel"]>;
  readonly #contextConfig: RuntimeContextConfig;
  readonly #promptBundlePath: string | undefined;
  #activeRun: ActiveRuntimeRun | undefined;

  constructor(options: RuntimeRunServiceOptions) {
    this.#workingDirectory = options.workingDirectory;
    this.#contextConfig = options.contextConfig ?? runtimeHostConfig.context;
    this.#promptBundlePath = options.promptBundlePath;
    this.#onEvent = options.onEvent;
    this.#createModel =
      options.createModel ??
      ((params) =>
        new CatalogModelPort({
          providerId: params.providerId,
          modelId: params.modelId,
          protocol: params.protocol,
          reasoningLevel: params.reasoningLevel,
          apiKey: params.apiKey,
          maximumRecoveryAttempts: runtimeHostConfig.streamRecovery.maximumAttempts,
        }));
    this.#store = new SqliteEventStore({
      databasePath: join(options.workingDirectory, runtimeHostConfig.databaseFileName),
      onEvent: (event) => {
        const activeRun = this.#activeRun;
        if (activeRun === undefined) return;
        if (event.type === "run.created") activeRun.runId = event.runId;
        this.#onEvent(
          runtimeRpcEventSchema.parse({
            protocolVersion: 1,
            requestId: activeRun.requestId,
            kind: "event",
            event,
          }),
        );
      },
    });
  }

  async handle(request: RuntimeRpcRequest): Promise<RuntimeRpcResponse> {
    if (request.method === "runtime.run.cancel") return this.#cancel(request);
    if (request.method !== "runtime.run.start") {
      if (request.method === "runtime.shutdown") {
        const activeRun = this.#activeRun;
        if (activeRun !== undefined) {
          activeRun.controller.abort(
            new Error("Run cancelled because the runtime is shutting down"),
          );
          await activeRun.settled;
        }
      }
      return handleRuntimeRpcRequest(request);
    }
    if (this.#activeRun !== undefined) {
      return errorResponse(request.requestId, "runtime_busy", "Runtime is already executing a run");
    }
    let markSettled = (): void => undefined;
    const settled = new Promise<void>((resolvePromise) => {
      markSettled = resolvePromise;
    });
    const activeRun: ActiveRuntimeRun = {
      requestId: request.requestId,
      controller: new AbortController(),
      settled,
      markSettled,
    };
    this.#activeRun = activeRun;
    try {
      const engine = new RunEngine({
        store: this.#store,
        model: this.#createModel(request.params),
        context: new PersistentConversationContext({
          store: this.#store,
          workingDirectory: this.#workingDirectory,
          model: getBuiltInModel(request.params.modelId),
          protocol: request.params.protocol,
          reasoningLevel: request.params.reasoningLevel,
          config: this.#contextConfig,
          ...(this.#promptBundlePath === undefined
            ? {}
            : { promptBundlePath: this.#promptBundlePath }),
        }),
        policy: new RejectUnexpectedActionPolicy(),
        executor: new RejectUnexpectedActionExecutor(),
        verifier: new BasicOutputVerifier(),
        clock: new SystemClock(),
        ids: new RandomIdGenerator(),
        maxCycles: runtimeHostConfig.maximumCycles,
      });
      const run = await engine.start({
        sessionId: request.params.sessionId,
        userInput: request.params.userInput,
        signal: activeRun.controller.signal,
      });
      return runtimeRpcResponseSchema.parse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        result: run,
      });
    } catch (error) {
      return errorResponse(
        request.requestId,
        "run_failed",
        error instanceof Error ? error.message : "Runtime run failed",
      );
    } finally {
      if (this.#activeRun === activeRun) this.#activeRun = undefined;
      activeRun.markSettled();
    }
  }

  #cancel(
    request: Extract<RuntimeRpcRequest, { method: "runtime.run.cancel" }>,
  ): RuntimeRpcResponse {
    const activeRun = this.#activeRun;
    if (activeRun?.runId !== request.params.runId) {
      return errorResponse(request.requestId, "run_not_active", "The requested run is not active");
    }
    activeRun.controller.abort(new Error("Run cancelled by the user"));
    return runtimeRpcResponseSchema.parse({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: { status: "cancellation_requested", runId: request.params.runId },
    });
  }

  close(): void {
    this.#store.close();
  }
}

export function handleRuntimeRpcRequest(request: RuntimeRpcRequest): RuntimeRpcResponse {
  if (request.method === "runtime.ping") {
    return runtimeRpcResponseSchema.parse({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: { status: "ready", pid: process.pid },
    });
  }
  if (request.method === "runtime.shutdown") {
    return runtimeRpcResponseSchema.parse({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: { status: "shutting_down" },
    });
  }
  return errorResponse(
    request.requestId,
    "run_service_required",
    "Runtime run requests require a configured run service",
  );
}

function errorResponse(requestId: string, code: string, message: string): RuntimeRpcResponse {
  return runtimeRpcResponseSchema.parse({
    protocolVersion: 1,
    requestId,
    ok: false,
    error: { code, message },
  });
}

export function runRuntimeStdioHost(options: RuntimeStdioHostOptions): void {
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  const handler = options.handleRequest ?? handleRuntimeRpcRequest;
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    void (async () => {
      let requestId = "invalid-request";
      let request: RuntimeRpcRequest | undefined;
      let response: RuntimeRpcResponse;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (typeof parsed === "object" && parsed !== null && "requestId" in parsed) {
          const candidate = entityIdSchema.safeParse(parsed.requestId);
          if (candidate.success) requestId = candidate.data;
        }
        request = runtimeRpcRequestSchema.parse(parsed);
        response = await handler(request);
      } catch (error) {
        response = errorResponse(
          requestId,
          "invalid_request",
          error instanceof Error ? error.message : "Invalid runtime RPC request",
        );
      }
      options.output.write(`${JSON.stringify(response)}\n`);
      if (request?.method === "runtime.shutdown" && response.ok) {
        lines.close();
        options.onShutdown?.();
      }
    })();
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  const service = new RuntimeRunService({
    workingDirectory: process.cwd(),
    onEvent: (event) => {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    },
  });
  runRuntimeStdioHost({
    input: process.stdin,
    output: process.stdout,
    handleRequest: async (request) => {
      const response = await service.handle(request);
      if (request.method === "runtime.shutdown" && response.ok) service.close();
      return response;
    },
    onShutdown: () => {
      process.stdin.unref();
    },
  });
}
