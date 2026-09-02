import type { DesktopSettings } from "@aquawisp/contracts";
import { getBuiltInModel, resolveReasoningLevel } from "@aquawisp/models-catalog";

export interface DesktopRunSelectionInput {
  readonly modelId: string;
  readonly reasoningLevel: string;
}

export interface DesktopRunSelection {
  readonly providerId: string;
  readonly modelId: string;
  readonly protocol: DesktopSettings["protocol"];
  readonly reasoningLevel: string;
}

export function resolveDesktopRunSelection(
  settings: DesktopSettings,
  input: DesktopRunSelectionInput,
): DesktopRunSelection {
  const model = getBuiltInModel(input.modelId);
  if (model.providerId !== settings.providerId) {
    throw new Error("Session model does not belong to the configured provider");
  }
  if (!model.supportedProtocols.includes(settings.protocol)) {
    throw new Error("Session model does not support the configured protocol");
  }
  return {
    providerId: settings.providerId,
    modelId: model.id,
    protocol: settings.protocol,
    reasoningLevel: resolveReasoningLevel(model, input.reasoningLevel).id,
  };
}
