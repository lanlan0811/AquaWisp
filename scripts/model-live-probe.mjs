import { OpenAICompatibleClient } from "@aquawisp/model";

const requiredEnvironmentNames = [
  "AQUAWISP_MODEL_API_KEY",
  "AQUAWISP_MODEL_BASE_URL",
  "AQUAWISP_MODEL_ID",
  "AQUAWISP_MODEL_PROTOCOL",
  "AQUAWISP_MODEL_PROMPT",
];

const missing = requiredEnvironmentNames.filter((name) => {
  const value = process.env[name];
  return value === undefined || value.trim() === "";
});
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const protocol = process.env.AQUAWISP_MODEL_PROTOCOL;
if (protocol !== "chat_completions" && protocol !== "responses") {
  throw new Error("AQUAWISP_MODEL_PROTOCOL must be chat_completions or responses");
}

const modelId = process.env.AQUAWISP_MODEL_ID;
const prompt = process.env.AQUAWISP_MODEL_PROMPT;
const apiKey = process.env.AQUAWISP_MODEL_API_KEY;
const baseUrl = process.env.AQUAWISP_MODEL_BASE_URL;
if (
  modelId === undefined ||
  prompt === undefined ||
  apiKey === undefined ||
  baseUrl === undefined
) {
  throw new Error("Required model probe environment variables were unavailable");
}

const reasoningLevel = process.env.AQUAWISP_MODEL_REASONING_LEVEL;
const client = new OpenAICompatibleClient({ apiKey, baseUrl, protocol });
const body =
  protocol === "chat_completions"
    ? { messages: [{ role: "user", content: prompt }] }
    : { input: prompt };

let eventCount = 0;
let text = "";
for await (const event of client.stream({
  model: modelId,
  ...(reasoningLevel === undefined ? {} : { reasoningLevel }),
  body,
})) {
  eventCount += 1;
  if (event.kind === "text_delta") {
    text += event.delta;
  }
  if (event.kind === "completed") {
    console.log(
      JSON.stringify({
        providerBaseUrl: baseUrl,
        modelId,
        protocol,
        eventCount,
        finishReason: event.finishReason,
        text,
      }),
    );
  }
}
