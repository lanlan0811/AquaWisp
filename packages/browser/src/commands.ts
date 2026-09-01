import { z } from "zod";

export const browserCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), url: z.string().url() }).strict(),
  z.object({ kind: z.literal("back") }).strict(),
  z.object({ kind: z.literal("forward") }).strict(),
  z.object({ kind: z.literal("reload") }).strict(),
  z.object({ kind: z.literal("snapshot") }).strict(),
  z.object({ kind: z.literal("screenshot") }).strict(),
]);
export const browserRequestSchema = z
  .object({ requestId: z.string().min(1), tabId: z.string().min(1), command: browserCommandSchema })
  .strict();
export type BrowserCommand = z.infer<typeof browserCommandSchema>;
export type BrowserRequest = z.infer<typeof browserRequestSchema>;

export function assertAllowedUrl(value: string, allowedProtocols: readonly string[]): URL {
  const url = new URL(value);
  if (!allowedProtocols.includes(url.protocol))
    throw new Error(`Browser URL protocol is not allowed: ${url.protocol}`);
  return url;
}
