import type {
  ActionRecord,
  ApprovalRequest,
  AuthorizationDecision,
  ModelSignal,
  Observation,
  Verification,
} from "@aquawisp/contracts";

export interface ReasonContext {
  readonly runId: string;
  readonly cycle: number;
  readonly userInput: string;
  readonly observations: readonly Observation[];
}

export interface ModelPort {
  reason(context: ReasonContext, signal: AbortSignal): AsyncIterable<ModelSignal>;
}

export interface AuthorizationResult {
  readonly decision: AuthorizationDecision;
  readonly approvalRequest?: ApprovalRequest;
}

export interface PolicyPort {
  authorize(action: ActionRecord): Promise<AuthorizationResult>;
}

export interface ActionExecutorPort {
  execute(action: ActionRecord, signal: AbortSignal): Promise<Observation>;
}

export interface VerificationPort {
  verifyAction(action: ActionRecord, observation: Observation): Promise<Verification>;
  verifyFinal(content: string, observations: readonly Observation[]): Promise<Verification>;
}

export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  next(namespace: "run" | "trace" | "event" | "step" | "action"): string;
}
