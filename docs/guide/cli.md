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

## `check`

Fails (exit 1) when a running console's recent traffic or a saved load-test run breaks a budget, for CI or a pre-push script:

```bash
npx @singhak/nodeui-cli check --window 300 --max-p99 300 --max-error-rate 1 http://127.0.0.1:3000
npx @singhak/nodeui-cli check --run latest --max-regression 10 http://127.0.0.1:3000
```

| Option                          | Meaning                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `--window <sec>`                | check the last N seconds (default 300)                                                           |
| `--run <name\|latest>`          | check a saved run instead                                                                        |
| `--max-p50/--max-p95/--max-p99` | latency budgets in ms                                                                            |
| `--max-error-rate <pct>`        | percentage of 5xx responses                                                                      |
| `--min-rps <n>`                 | throughput floor                                                                                 |
| `--max-loop-p99 <ms>`           | event-loop delay budget                                                                          |
| `--max-rss-mb <n>`              | memory budget                                                                                    |
| `--max-regression <pct>`        | with `--run`: p99 may rise and throughput may fall at most this much against the pinned baseline |

Exit codes: `0` all budgets held, `1` a budget failed, `2` nothing to check (no traffic, unknown run, console unreachable, or no limits given).
