import type { StreamModelRequest, OpenAICompatibleClient } from "./client.js";
import { ModelStreamInterruptedError, type ModelStreamEvent } from "./stream-events.js";

export interface StreamRecoveryContext {
  readonly originalRequest: StreamModelRequest;
  readonly emittedEvents: readonly ModelStreamEvent[];
  readonly interruption: ModelStreamInterruptedError;
  readonly recoveryAttempt: number;
}

export interface RecoverableModelStreamOptions {
  readonly client: OpenAICompatibleClient;
  readonly request: StreamModelRequest;
  readonly maximumRecoveryAttempts: number;
  readonly resume: (context: StreamRecoveryContext) => Promise<StreamModelRequest>;
}

export class ModelStreamRecoveryExhaustedError extends Error {
  readonly interruption: ModelStreamInterruptedError;
  readonly recoveryAttempts: number;

  constructor(interruption: ModelStreamInterruptedError, recoveryAttempts: number) {
    super(
      `Model stream recovery exhausted after ${recoveryAttempts.toString()} attempt(s): ${interruption.message}`,
      { cause: interruption },
    );
    this.name = "ModelStreamRecoveryExhaustedError";
    this.interruption = interruption;
    this.recoveryAttempts = recoveryAttempts;
  }
}

export async function* streamWithRecovery(
  options: RecoverableModelStreamOptions,
): AsyncIterable<ModelStreamEvent> {
  if (!Number.isInteger(options.maximumRecoveryAttempts) || options.maximumRecoveryAttempts < 0) {
    throw new Error("maximumRecoveryAttempts must be a non-negative integer");
  }

  const emittedEvents: ModelStreamEvent[] = [];
  let request = options.request;
  for (
    let recoveryAttempt = 0;
    recoveryAttempt <= options.maximumRecoveryAttempts;
    recoveryAttempt += 1
  ) {
    try {
      for await (const event of options.client.stream(request)) {
        const sequenced = withSequence(event, emittedEvents.length);
        emittedEvents.push(sequenced);
        yield sequenced;
      }
      return;
    } catch (error) {
      if (!(error instanceof ModelStreamInterruptedError)) {
        throw error;
      }
      if (request.signal?.aborted === true) {
        throw error;
      }
      if (recoveryAttempt === options.maximumRecoveryAttempts) {
        throw new ModelStreamRecoveryExhaustedError(error, recoveryAttempt);
      }
      const continuation = await options.resume({
        originalRequest: options.request,
        emittedEvents,
        interruption: error,
        recoveryAttempt: recoveryAttempt + 1,
      });
      request = {
        ...continuation,
        ...(options.request.signal === undefined ? {} : { signal: options.request.signal }),
      };
    }
  }
  throw new Error("Model stream recovery loop ended unexpectedly");
}

function withSequence(event: ModelStreamEvent, sequence: number): ModelStreamEvent {
  return { ...event, sequence };
}
