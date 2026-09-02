import {
  approvalUserDecisionSchema,
  type ApprovalRequest,
  type ApprovalUserDecision,
} from "@aquawisp/contracts";

import type { ApprovalPort, ApprovalWaitRequest } from "./ports.js";

interface PendingApproval {
  readonly runId: string;
  readonly finish: (decision: ApprovalUserDecision) => void;
  readonly fail: (error: Error) => void;
}

export class SessionApprovalCoordinator implements ApprovalPort {
  readonly #pending = new Map<string, PendingApproval>();
  readonly #sessionGrants = new Set<string>();

  hasSessionGrant(sessionId: string, request: ApprovalRequest): boolean {
    return this.#sessionGrants.has(grantKey(sessionId, request));
  }

  rememberSessionGrant(sessionId: string, request: ApprovalRequest): void {
    this.#sessionGrants.add(grantKey(sessionId, request));
  }

  waitForDecision(waitRequest: ApprovalWaitRequest): Promise<ApprovalUserDecision> {
    const { request, signal } = waitRequest;
    if (this.#pending.has(request.id)) {
      return Promise.reject(new Error(`Approval ${request.id} is already waiting for a decision`));
    }
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise<ApprovalUserDecision>((resolvePromise, rejectPromise) => {
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
        this.#pending.delete(request.id);
      };
      const onAbort = (): void => {
        cleanup();
        rejectPromise(abortError(signal));
      };
      this.#pending.set(request.id, {
        runId: request.runId,
        finish: (decision) => {
          cleanup();
          resolvePromise(decision);
        },
        fail: (error) => {
          cleanup();
          rejectPromise(error);
        },
      });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  resolve(input: unknown): void {
    const decision = approvalUserDecisionSchema.parse(input);
    const pending = this.#pending.get(decision.approvalId);
    if (pending?.runId !== decision.runId) {
      throw new Error("Approval is not pending for the specified Run");
    }
    pending.finish(decision);
  }

  rejectAll(error: Error): void {
    for (const pending of [...this.#pending.values()]) pending.fail(error);
  }
}

function grantKey(sessionId: string, request: ApprovalRequest): string {
  return JSON.stringify([
    sessionId,
    request.actionType,
    request.target,
    request.riskReason,
    request.impact,
  ]);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Approval wait was cancelled");
}
