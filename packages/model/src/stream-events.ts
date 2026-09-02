import type { JsonObject } from "@aquawisp/contracts";

export type ModelStreamEvent =
  | { readonly kind: "text_delta"; readonly delta: string; readonly sequence: number }
  | { readonly kind: "reasoning_delta"; readonly delta: string; readonly sequence: number }
  | {
      readonly kind: "stream_recovery";
      readonly recoveryAttempt: number;
      readonly priorEventCount: number;
      readonly sequence: number;
    }
  | {
      readonly kind: "tool_call_delta";
      readonly callId: string;
      readonly name: string | null;
      readonly argumentsDelta: string;
      readonly sequence: number;
    }
  | { readonly kind: "usage"; readonly usage: JsonObject; readonly sequence: number }
  | { readonly kind: "completed"; readonly finishReason: string | null; readonly sequence: number };

export class ModelHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`Model request failed with HTTP ${status.toString()}`);
    this.name = "ModelHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class ModelStreamInterruptedError extends Error {
  readonly emittedEvents: number;

  constructor(message: string, emittedEvents: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelStreamInterruptedError";
    this.emittedEvents = emittedEvents;
  }
}

export class ModelProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelProtocolError";
  }
}
