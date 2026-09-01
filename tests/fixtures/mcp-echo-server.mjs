import { createInterface } from "node:readline";

const tools = [
  {
    name: "echo",
    description: "Return the supplied value",
    inputSchema: { type: "object", additionalProperties: true },
  },
  {
    name: "large",
    description: "Return a deliberately large observation",
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "slow",
    description: "Return after the client timeout",
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "hidden",
    description: "A tool that is intentionally not allowlisted",
    inputSchema: { type: "object", additionalProperties: false },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "aquawisp-test-mcp", version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    if (message.params.name === "slow") {
      setTimeout(() => {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: "late" }] },
        });
      }, 250);
      return;
    }
    const text =
      message.params.name === "large"
        ? "x".repeat(4096)
        : JSON.stringify(message.params.arguments ?? {});
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text }] },
    });
    return;
  }
  if (message.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unsupported method: ${message.method}` },
    });
  }
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  if (line.trim() !== "") handle(JSON.parse(line));
});
