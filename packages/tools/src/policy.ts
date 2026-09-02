import {
  actionRecordSchema,
  type ActionRecord,
  type ApprovalRequest,
  type AuthorizationDecision,
} from "@aquawisp/contracts";

import {
  getModeDefinition,
  getToolDefinition,
  toolCatalog,
  type ExecutionMode,
  type TargetScope,
} from "./catalog.js";

export interface PolicyTarget {
  readonly scope: TargetScope;
  readonly description: string;
}

export interface ProjectPolicyRules {
  readonly explicitlyDeniedToolIds: readonly string[];
  readonly projectDeniedToolIds: readonly string[];
}

export interface PolicyClock {
  now(): Date;
}

export interface ApprovalIdGenerator {
  nextApprovalId(): string;
}

export interface ToolPolicyEvaluatorOptions {
  readonly mode: ExecutionMode;
  readonly rules: ProjectPolicyRules;
  readonly clock: PolicyClock;
  readonly ids: ApprovalIdGenerator;
}

export interface ToolAuthorizationResult {
  readonly decision: AuthorizationDecision;
  readonly approvalRequest?: ApprovalRequest;
}

export class ToolPolicyEvaluator {
  readonly #mode: ExecutionMode;
  readonly #rules: ProjectPolicyRules;
  readonly #clock: PolicyClock;
  readonly #ids: ApprovalIdGenerator;

  constructor(options: ToolPolicyEvaluatorOptions) {
    this.#mode = options.mode;
    this.#rules = options.rules;
    this.#clock = options.clock;
    this.#ids = options.ids;
  }

  authorize(actionInput: unknown, target: PolicyTarget): ToolAuthorizationResult {
    const actionResult = actionRecordSchema.safeParse(actionInput);
    if (!actionResult.success) {
      return this.#denied(toolCatalog.decisionCodes.invalidAction, "工具动作不符合已注册的契约。");
    }
    const action = actionResult.data;
    const definition = getToolDefinition(action.toolName);
    if (definition?.revision !== action.toolRevision) {
      return this.#denied(
        toolCatalog.decisionCodes.unknownTool,
        "工具或工具版本未在注册表中声明。",
      );
    }
    if (definition.sideEffect !== action.sideEffect) {
      return this.#denied(
        toolCatalog.decisionCodes.invalidAction,
        "工具副作用声明与注册表不一致。",
      );
    }
    if (this.#rules.explicitlyDeniedToolIds.includes(action.toolName)) {
      return this.#denied(toolCatalog.decisionCodes.explicitDeny, "项目策略明确拒绝该工具。");
    }
    if (this.#rules.projectDeniedToolIds.includes(action.toolName)) {
      return this.#denied(toolCatalog.decisionCodes.projectDeny, "当前项目规则拒绝该工具。");
    }
    const modeDefinition = getModeDefinition(this.#mode);
    if (modeDefinition.denyRiskLevels.includes(definition.riskLevel)) {
      return this.#denied(
        toolCatalog.decisionCodes.modeDeny,
        "当前运行模式不允许该风险等级的动作。",
      );
    }
    if (toolCatalog.boundaryApprovalScopes.includes(target.scope)) {
      return this.#approval(action, target, toolCatalog.decisionCodes.boundaryApproval);
    }
    if (modeDefinition.autoAllowRiskLevels.includes(definition.riskLevel)) {
      return {
        decision: {
          outcome: "allowed",
          reasonCode: toolCatalog.decisionCodes.modeAllow,
          humanSummary: "当前运行模式允许该工具动作。",
        },
      };
    }
    return this.#approval(action, target, toolCatalog.decisionCodes.riskApproval);
  }

  #denied(reasonCode: string, humanSummary: string): ToolAuthorizationResult {
    return { decision: { outcome: "denied", reasonCode, humanSummary } };
  }

  #approval(
    action: ActionRecord,
    target: PolicyTarget,
    reasonCode: string,
  ): ToolAuthorizationResult {
    const id = this.#ids.nextApprovalId();
    const requestedAt = this.#clock.now().toISOString();
    const riskReason =
      reasonCode === toolCatalog.decisionCodes.boundaryApproval
        ? "操作目标跨越了当前工作区、秘密或平台安全边界。"
        : "当前运行模式不会自动放行该风险等级的操作。";
    return {
      decision: {
        outcome: "requires_approval",
        reasonCode,
        humanSummary: "该动作跨越了当前的安全边界，需要用户审批。",
        approvalId: id,
      },
      approvalRequest: {
        id,
        runId: action.runId,
        actionId: action.id,
        status: "pending",
        actionType: action.toolName,
        target: target.description,
        riskReason,
        impact: `如果允许，沧渡将对“${target.description}”执行 ${action.toolName}；授权只覆盖本次精确范围。`,
        requestedAt,
        resolvedAt: null,
      },
    };
  }
}
