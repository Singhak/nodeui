# CLI, attach and MCP

```bash
npx @singhak/nodeui-cli attach -- node server.js      # console on your app's own port
npx @singhak/nodeui-cli dashboard api=http://127.0.0.1:3000 worker=http://127.0.0.1:3001
```

`attach` preloads NodeUI into the process you start (it cannot attach to one that is already running). `dashboard` is a loopback page that shows health, error rate and p95 for several consoles and opens each through a proxy.

## Let an AI agent read it (MCP)

```json
{
  "mcpServers": {
    "nodeui": { "command": "npx", "args": ["@singhak/nodeui-cli", "mcp", "http://127.0.0.1:3000"] }
  }
}
```

`nodeui mcp` is a read-only [MCP](https://modelcontextprotocol.io) server: an overview digest, grouped errors, requests joined with their queries/outgoing calls/logs, and more. It reads the console API, so data is already masked and no confirmation-gated action is reachable.

See [`packages/cli`](https://github.com/Singhak/nodeui/tree/master/packages/cli) for options and limits.
