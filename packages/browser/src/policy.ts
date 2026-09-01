import { z } from "zod";

import source from "./browser-policy.data.json" with { type: "json" };

const browserPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    initialUrl: z.literal("about:blank"),
    allowedProtocols: z.array(z.enum(["http:", "https:"])).min(1),
    debuggerProtocolVersion: z.string().min(1),
  })
  .strict()
  .refine(
    ({ allowedProtocols }) => new Set(allowedProtocols).size === allowedProtocols.length,
    "Browser protocols must be unique",
  );

export type BrowserPolicy = z.infer<typeof browserPolicySchema>;
export const browserPolicy: BrowserPolicy = browserPolicySchema.parse(source);

export interface WebviewSecurityPreferences {
  nodeIntegration?: boolean;
  contextIsolation?: boolean;
  sandbox?: boolean;
  preload?: string;
}

export function hardenWebviewPreferences(preferences: WebviewSecurityPreferences): void {
  preferences.nodeIntegration = false;
  preferences.contextIsolation = true;
  preferences.sandbox = true;
  Reflect.deleteProperty(preferences, "preload");
}

export function assertBrowserUrl(value: string, policy = browserPolicy): URL | "about:blank" {
  if (value === policy.initialUrl) return value;
  const url = new URL(value);
  if (!policy.allowedProtocols.includes(url.protocol as "http:" | "https:")) {
    throw new Error(`Browser URL protocol is not allowed: ${url.protocol}`);
  }
  return url;
}
