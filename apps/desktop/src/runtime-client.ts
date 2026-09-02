import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import {
  runtimeRpcRequestSchema,
  runtimeRpcMessageSchema,
  type RuntimeRpcCommand,
  type RuntimeRpcEvent,
  type RuntimeRpcResponse,
} from "@aquawisp/contracts";

export interface RuntimeProcessClientOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly requestTimeoutMs: number;
  readonly maxLineBytes: number;
  readonly maxStderrBytes: number;
  readonly onEvent?: (event: RuntimeRpcEvent) => void;
}

interface PendingRequest {
  readonly resolve: (response: RuntimeRpcResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class RuntimeProcessClient {
  readonly #options: RuntimeProcessClientOptions;
  readonly #pending = new Map<string, PendingRequest>();
  #process: ChildProcessWithoutNullStreams | undefined;
  #counter = 0;
  #stderrBytes = 0;

  constructor(options: RuntimeProcessClientOptions) {
    if (!Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new Error("Runtime request timeout must be a positive integer");
    }
    if (!Number.isInteger(options.maxLineBytes) || options.maxLineBytes <= 0) {
      throw new Error("Runtime line limit must be a positive integer");
    }
    if (!Number.isInteger(options.maxStderrBytes) || options.maxStderrBytes <= 0) {
      throw new Error("Runtime stderr limit must be a positive integer");
    }
    this.#options = options;
  }

  start(): void {
    if (this.#process !== undefined) throw new Error("Runtime process is already started");
    const child = spawn(this.#options.executable, [...this.#options.args], {
      cwd: this.#options.cwd,
      env: { ...this.#options.environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#process = child;
    this.#stderrBytes = 0;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      this.#handleLine(line);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.#stderrBytes += Buffer.byteLength(chunk);
      if (this.#stderrBytes > this.#options.maxStderrBytes) {
        this.#rejectAll(new Error("Runtime stderr exceeded the configured limit"));
        child.kill();
      }
    });
    child.on("error", (error) => {
      this.#rejectAll(error);
    });
    child.on("exit", (code, signal) => {
      this.#process = undefined;
      this.#rejectAll(
        new Error(
          `Runtime process exited before completing requests: code=${String(code)} signal=${String(signal)}`,
        ),
      );
    });
  }

  request(
    input: "runtime.ping" | "runtime.shutdown" | RuntimeRpcCommand,
    timeoutMs = this.#options.requestTimeoutMs,
  ): Promise<RuntimeRpcResponse> {
    const child = this.#process;
    if (child === undefined) throw new Error("Runtime process is not started");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Runtime request timeout must be a positive integer");
    }
    this.#counter += 1;
    const command = typeof input === "string" ? { method: input, params: {} } : input;
    const request = runtimeRpcRequestSchema.parse({
      protocolVersion: 1,
      requestId: `desktop-rpc-${this.#counter.toString().padStart(6, "0")}`,
      ...command,
    });
    return new Promise<RuntimeRpcResponse>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.requestId);
        rejectPromise(new Error(`Runtime request timed out: ${request.method}`));
      }, timeoutMs);
      this.#pending.set(request.requestId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
      child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  async close(): Promise<void> {
    const child = this.#process;
    if (child === undefined) return;
    let shutdownError: Error | undefined;
    try {
      await this.request("runtime.shutdown");
    } catch (error) {
      shutdownError = error instanceof Error ? error : new Error("Runtime shutdown failed");
    } finally {
      child.stdin.end();
    }
    await this.#waitForExit(child);
    if (shutdownError !== undefined) throw shutdownError;
  }

  #handleLine(line: string): void {
    if (Buffer.byteLength(line, "utf8") > this.#options.maxLineBytes) {
      this.#rejectAll(new Error("Runtime response exceeded the configured line limit"));
      this.#process?.kill();
      return;
    }
    let response: RuntimeRpcResponse;
    try {
      const message = runtimeRpcMessageSchema.parse(JSON.parse(line) as unknown);
      if ("kind" in message) {
        this.#options.onEvent?.(message);
        return;
      }
      response = message;
    } catch (error) {
      this.#rejectAll(new Error("Runtime emitted an invalid RPC response", { cause: error }));
      this.#process?.kill();
      return;
    }
    const pending = this.#pending.get(response.requestId);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.#pending.delete(response.requestId);
    pending.resolve(response);
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        child.kill();
        rejectPromise(new Error("Runtime process did not exit after shutdown"));
      }, this.#options.requestTimeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }
}
