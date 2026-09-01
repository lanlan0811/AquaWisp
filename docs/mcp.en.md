# stdio MCP client

AquaWisp 0.1 supports local stdio MCP servers only. The implementation in `packages/tools` uses the official TypeScript SDK to spawn the server process, negotiate MCP, discover tools, and call them. It does not automatically enable a network transport.

## Default posture

The built-in registry at `packages/tools/src/mcp-registry.data.json` enables no servers by default. A server must pass the versioned schema and explicitly declare:

- a stable, unique server ID;
- an executable, argv, and a workspace-relative cwd;
- an exact tool allowlist;
- environment-variable name mappings; and
- whether the server is enabled.

Example definition:

```json
{
  "id": "local-search",
  "name": "Local search service",
  "command": "node",
  "args": ["tools/local-search-server.mjs"],
  "cwd": ".",
  "environment": {
    "SERVICE_TOKEN": "AQUAWISP_LOCAL_SEARCH_TOKEN"
  },
  "allowedTools": ["search"],
  "enabled": true
}
```

Each `environment` key is the name passed to the server and its value is the name of an existing variable in the AquaWisp host process. The registry never stores a plaintext secret. A missing source variable rejects the connection.

## Security boundaries

- The stdio transport starts an executable with argv and does not concatenate a shell command.
- The real cwd must remain inside the workspace; a symlink or junction escape is rejected.
- Discovery exposes allowlisted tools only, and the allowlist is checked again before every call.
- Initialization, tool calls, protocol reads, stderr, and returned observations use configured limits.
- Every MCP result is marked `untrusted` and cannot alter permissions, policies, or approval decisions.
- Closing the host closes every client connection and reaps the server processes owned by the SDK.

A server definition still represents authority to launch a local executable. Desktop integration must pass that action through AquaWisp's mode, risk, approval, and ledger flow; presence in the registry never bypasses authorization.
