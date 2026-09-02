import { randomUUID } from "node:crypto";

import type { ActionRecord, Observation, Verification } from "@aquawisp/contracts";

import type {
  ActionExecutorPort,
  ClockPort,
  IdGeneratorPort,
  PolicyPort,
  VerificationPort,
} from "./ports.js";

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

export class RandomIdGenerator implements IdGeneratorPort {
  next(namespace: "run" | "trace" | "event" | "step" | "action"): string {
    return `${namespace}-${randomUUID()}`;
  }
}

export class RejectUnexpectedActionPolicy implements PolicyPort {
  authorize(): Promise<{
    readonly decision: {
      readonly outcome: "denied";
      readonly reasonCode: "undeclared_model_action";
      readonly humanSummary: "当前会话未声明可执行工具，已拒绝模型动作";
    };
  }> {
    return Promise.resolve({
      decision: {
        outcome: "denied",
        reasonCode: "undeclared_model_action",
        humanSummary: "当前会话未声明可执行工具，已拒绝模型动作",
      },
    });
  }
}

export class RejectUnexpectedActionExecutor implements ActionExecutorPort {
  execute(): Promise<Observation> {
    return Promise.reject(new Error("Undeclared model actions cannot be executed"));
  }
}

export class BasicOutputVerifier implements VerificationPort {
  verifyAction(action: ActionRecord, observation: Observation): Promise<Verification> {
    return Promise.resolve({
      success: observation.ok,
      summary: observation.ok ? "动作返回成功" : "动作返回失败",
      evidence: { actionId: action.id, observationOk: observation.ok },
    });
  }

  verifyFinal(content: string): Promise<Verification> {
    return Promise.resolve({
      success: content.trim() !== "",
      summary: content.trim() === "" ? "模型最终输出为空" : "模型最终输出非空",
      evidence: { contentLength: content.length },
    });
  }
}
