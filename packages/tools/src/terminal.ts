import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

export interface TerminalExecutorOptions {
  readonly workspaceRoot: string;
  readonly maximumOutputBytes: number;
  readonly defaultTimeoutMilliseconds: number;
}

export interface TerminalCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly timeoutMilliseconds?: number;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface TerminalResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputTruncated: boolean;
}

export class TerminalExecutor {
  readonly #workspaceRoot: string;
  readonly #maximumOutputBytes: number;
  readonly #defaultTimeoutMilliseconds: number;

  private constructor(options: TerminalExecutorOptions, workspaceRoot: string) {
    if (!Number.isInteger(options.maximumOutputBytes) || options.maximumOutputBytes <= 0) {
      throw new Error("maximumOutputBytes must be a positive integer");
    }
    if (
      !Number.isInteger(options.defaultTimeoutMilliseconds) ||
      options.defaultTimeoutMilliseconds <= 0
    ) {
      throw new Error("defaultTimeoutMilliseconds must be a positive integer");
    }
    this.#workspaceRoot = workspaceRoot;
    this.#maximumOutputBytes = options.maximumOutputBytes;
    this.#defaultTimeoutMilliseconds = options.defaultTimeoutMilliseconds;
  }

  static async create(options: TerminalExecutorOptions): Promise<TerminalExecutor> {
    return new TerminalExecutor(options, await realpath(options.workspaceRoot));
  }

  async execute(command: TerminalCommand): Promise<TerminalResult> {
    if (command.executable.trim() === "") {
      throw new Error("Terminal executable cannot be empty");
    }
    const timeoutMilliseconds = command.timeoutMilliseconds ?? this.#defaultTimeoutMilliseconds;
    if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
      throw new Error("timeoutMilliseconds must be a positive integer");
    }
    const cwd = await this.#workspaceDirectory(command.cwd);
    return new Promise<TerminalResult>((resolveResult, rejectResult) => {
      const child = spawn(command.executable, [...command.arguments], {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env:
          command.environment === undefined
            ? process.env
            : { ...process.env, ...command.environment },
      });
      const stdout = new BoundedText(this.#maximumOutputBytes);
      const stderr = new BoundedText(this.#maximumOutputBytes);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMilliseconds);
      child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
      child.once("error", (error) => {
        clearTimeout(timer);
        rejectResult(error);
      });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timer);
        resolveResult({
          exitCode,
          signal,
          stdout: stdout.text(),
          stderr: stderr.text(),
          timedOut,
          outputTruncated: stdout.truncated || stderr.truncated,
        });
      });
    });
  }

  async #workspaceDirectory(input: string): Promise<string> {
    const candidate = resolve(this.#workspaceRoot, input);
    if (!isInside(this.#workspaceRoot, candidate)) {
      throw new Error(`Terminal cwd escapes workspace: ${input}`);
    }
    const resolved = await realpath(candidate);
    if (!isInside(this.#workspaceRoot, resolved)) {
      throw new Error(`Terminal cwd resolves outside workspace: ${input}`);
    }
    return resolved;
  }
}

class BoundedText {
  readonly #maximumBytes: number;
  readonly #chunks: Buffer[] = [];
  #length = 0;
  truncated = false;

  constructor(maximumBytes: number) {
    this.#maximumBytes = maximumBytes;
  }

  append(chunk: Buffer): void {
    if (this.truncated) {
      return;
    }
    const remaining = this.#maximumBytes - this.#length;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    const accepted = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
    this.#chunks.push(accepted);
    this.#length += accepted.byteLength;
    this.truncated = accepted.byteLength < chunk.byteLength;
  }

  text(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }
}

function isInside(root: string, candidate: string): boolean {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || !pathRelative.startsWith("..");
}
