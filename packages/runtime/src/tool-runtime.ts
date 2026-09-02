import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  observationSchema,
  type ActionRecord,
  type AuthorizationDecision,
  type Observation,
} from "@aquawisp/contracts";
import {
  getToolDefinition,
  isBuiltInToolId,
  parseToolInput,
  TerminalExecutor,
  ToolPolicyEvaluator,
  toolCatalog,
  WebFetchClient,
  WorkspaceFilesystem,
  WorkspaceSearch,
  type ExecutionMode,
  type PolicyTarget,
} from "@aquawisp/tools";

import { RuntimeKnowledgeLibrary } from "./knowledge-library.js";
import type { ActionExecutorPort, ClockPort, IdGeneratorPort, PolicyPort } from "./ports.js";
import type { RuntimeToolConfig } from "./runtime-host-config.js";

export interface BuiltInToolRuntimeOptions {
  readonly workingDirectory: string;
  readonly knowledgeLibrary: RuntimeKnowledgeLibrary;
  readonly config: RuntimeToolConfig;
}

export class BuiltInToolRuntime implements ActionExecutorPort {
  readonly #workspaceRoot: string;
  readonly #knowledgeLibrary: RuntimeKnowledgeLibrary;
  readonly #config: RuntimeToolConfig;
  readonly #filesystem: WorkspaceFilesystem;
  readonly #search: WorkspaceSearch;
  readonly #terminal: TerminalExecutor;
  readonly #web: WebFetchClient;

  private constructor(
    options: BuiltInToolRuntimeOptions,
    workspaceRoot: string,
    filesystem: WorkspaceFilesystem,
    search: WorkspaceSearch,
    terminal: TerminalExecutor,
  ) {
    this.#workspaceRoot = workspaceRoot;
    this.#knowledgeLibrary = options.knowledgeLibrary;
    this.#config = options.config;
    this.#filesystem = filesystem;
    this.#search = search;
    this.#terminal = terminal;
    this.#web = new WebFetchClient({
      allowedProtocols: options.config.webAllowedProtocols,
      maximumResponseBytes: options.config.webMaximumResponseBytes,
    });
  }

  static async create(options: BuiltInToolRuntimeOptions): Promise<BuiltInToolRuntime> {
    const workspaceDirectory = join(
      options.workingDirectory,
      options.config.workspaceDirectoryName,
    );
    await mkdir(workspaceDirectory, { recursive: true });
    const workspaceRoot = await realpath(workspaceDirectory);
    const [filesystem, search, terminal] = await Promise.all([
      WorkspaceFilesystem.create({
        workspaceRoot,
        maximumFileBytes: options.config.filesystemMaximumFileBytes,
      }),
      WorkspaceSearch.create({
        workspaceRoot,
        maximumResults: options.config.searchMaximumResults,
        maximumFileBytes: options.config.searchMaximumFileBytes,
        maximumMatchCharacters: options.config.searchMaximumMatchCharacters,
      }),
      TerminalExecutor.create({
        workspaceRoot,
        maximumOutputBytes: options.config.terminalMaximumOutputBytes,
        defaultTimeoutMilliseconds: options.config.terminalDefaultTimeoutMilliseconds,
      }),
    ]);
    return new BuiltInToolRuntime(options, workspaceRoot, filesystem, search, terminal);
  }

  policy(mode: ExecutionMode, clock: ClockPort, ids: IdGeneratorPort): PolicyPort {
    const evaluator = new ToolPolicyEvaluator({
      mode,
      rules: {
        explicitlyDeniedToolIds: this.#config.explicitlyDeniedToolIds,
        projectDeniedToolIds: this.#config.projectDeniedToolIds,
      },
      clock,
      ids: { nextApprovalId: () => ids.next("approval") },
    });
    return {
      authorize: async (action) => {
        const definition = getToolDefinition(action.toolName);
        if (definition === undefined || !isBuiltInToolId(action.toolName)) {
          return evaluator.authorize(action, {
            scope: "workspace",
            description: "未注册工具",
          });
        }
        try {
          validateInput(action);
          return evaluator.authorize(action, await this.#targetFor(action));
        } catch (error) {
          const decision: AuthorizationDecision = {
            outcome: "denied",
            reasonCode: toolCatalog.decisionCodes.invalidAction,
            humanSummary:
              error instanceof Error ? error.message : "工具输入或目标不符合已注册的契约。",
          };
          return { decision };
        }
      },
    };
  }

  async execute(action: ActionRecord, signal: AbortSignal): Promise<Observation> {
    signal.throwIfAborted();
    if (!isBuiltInToolId(action.toolName))
      throw new Error(`Tool is not registered: ${action.toolName}`);
    // Domain results are normalized by the JSON observation contract at this boundary.
    let output: unknown = null;
    switch (action.toolName) {
      case "filesystem.read":
        output = await this.#filesystem.read(parseToolInput("filesystem.read", action.input).path);
        break;
      case "filesystem.glob":
        output = (
          await this.#search.glob(parseToolInput("filesystem.glob", action.input).pattern)
        ).map((path) => ({ path }));
        break;
      case "filesystem.grep":
        output = await this.#search.grep(parseToolInput("filesystem.grep", action.input).query);
        break;
      case "filesystem.write":
        output = await this.#filesystem.write(parseToolInput("filesystem.write", action.input));
        break;
      case "filesystem.edit": {
        const input = parseToolInput("filesystem.edit", action.input);
        output = await this.#filesystem.edit(
          input.path,
          input.expectedRevision,
          input.replacements,
        );
        break;
      }
      case "terminal.execute": {
        const input = parseToolInput("terminal.execute", action.input);
        output = await this.#terminal.execute(input, signal);
        break;
      }
      case "web.fetch":
        output = await this.#web.fetch({
          url: parseToolInput("web.fetch", action.input).url,
          signal,
        });
        break;
      case "kb.add":
        output = await this.#knowledgeLibrary.addFile(parseToolInput("kb.add", action.input).path);
        break;
      case "kb.search": {
        const input = parseToolInput("kb.search", action.input);
        output = this.#knowledgeLibrary.search(
          input.query,
          boundedLimit(
            input.limit,
            this.#config.knowledgeSearchDefaultLimit,
            this.#config.knowledgeSearchMaximumLimit,
          ),
        );
        break;
      }
      case "kb.list": {
        const input = parseToolInput("kb.list", action.input);
        output = this.#knowledgeLibrary.list(
          boundedLimit(
            input.limit,
            this.#config.knowledgeListDefaultLimit,
            this.#config.knowledgeListMaximumLimit,
          ),
        );
        break;
      }
      case "kb.status":
        parseToolInput("kb.status", action.input);
        output = this.#knowledgeLibrary.status();
        break;
    }
    return observationSchema.parse({
      ok: true,
      output: boundedJsonOutput(output, this.#config.maximumObservationBytes),
    });
  }

  async #targetFor(action: ActionRecord): Promise<PolicyTarget> {
    switch (action.toolName) {
      case "filesystem.read":
      case "filesystem.write":
      case "filesystem.edit":
        return await this.#pathTarget(parsePathInput(action));
      case "kb.add":
        return await this.#pathTarget(parseToolInput("kb.add", action.input).path);
      case "terminal.execute": {
        const input = parseToolInput("terminal.execute", action.input);
        const cwd = await this.#pathTarget(input.cwd);
        return {
          scope: "platform",
          description: `${input.executable}（工作目录：${cwd.description}）`,
        };
      }
      case "web.fetch":
        return {
          scope: "workspace",
          description: parseToolInput("web.fetch", action.input).url,
        };
      default:
        return { scope: "workspace", description: "当前工作区" };
    }
  }

  async #pathTarget(input: string): Promise<PolicyTarget> {
    const candidate = isAbsolute(input) ? resolve(input) : resolve(this.#workspaceRoot, input);
    const canonical = await canonicalTarget(candidate);
    const pathRelative = relative(this.#workspaceRoot, canonical);
    const inside =
      pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
    return {
      scope: inside ? "workspace" : "external",
      description: inside ? pathRelative || "." : canonical,
    };
  }
}

function validateInput(action: ActionRecord): void {
  if (!isBuiltInToolId(action.toolName))
    throw new Error(`Tool is not registered: ${action.toolName}`);
  switch (action.toolName) {
    case "filesystem.read":
      parseToolInput("filesystem.read", action.input);
      break;
    case "filesystem.glob":
      parseToolInput("filesystem.glob", action.input);
      break;
    case "filesystem.grep":
      parseToolInput("filesystem.grep", action.input);
      break;
    case "filesystem.write":
      parseToolInput("filesystem.write", action.input);
      break;
    case "filesystem.edit":
      parseToolInput("filesystem.edit", action.input);
      break;
    case "terminal.execute":
      parseToolInput("terminal.execute", action.input);
      break;
    case "web.fetch":
      parseToolInput("web.fetch", action.input);
      break;
    case "kb.add":
      parseToolInput("kb.add", action.input);
      break;
    case "kb.search":
      parseToolInput("kb.search", action.input);
      break;
    case "kb.list":
      parseToolInput("kb.list", action.input);
      break;
    case "kb.status":
      parseToolInput("kb.status", action.input);
      break;
  }
}

function parsePathInput(action: ActionRecord): string {
  if (action.toolName === "filesystem.read") {
    return parseToolInput("filesystem.read", action.input).path;
  }
  if (action.toolName === "filesystem.write") {
    return parseToolInput("filesystem.write", action.input).path;
  }
  if (action.toolName === "filesystem.edit") {
    return parseToolInput("filesystem.edit", action.input).path;
  }
  throw new Error("Action does not carry a filesystem path");
}

async function canonicalTarget(candidate: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch {
    const parent = dirname(candidate);
    if (parent === candidate) return candidate;
    return resolve(await canonicalTarget(parent), candidate.slice(parent.length + 1));
  }
}

function boundedLimit(input: number | undefined, fallback: number, maximum: number): number {
  const limit = input ?? fallback;
  if (limit > maximum)
    throw new Error(`Requested result limit exceeds configured maximum ${maximum.toString()}`);
  return limit;
}

function boundedJsonOutput(output: unknown, maximumBytes: number): unknown {
  const normalized = observationSchema.shape.output.parse(output);
  const encoded = new TextEncoder().encode(JSON.stringify(normalized));
  if (encoded.byteLength <= maximumBytes) return normalized;
  const previewBytes = Math.max(1, Math.floor(maximumBytes / 2));
  return {
    truncated: true,
    originalBytes: encoded.byteLength,
    preview: new TextDecoder().decode(encoded.slice(0, previewBytes)),
  };
}
