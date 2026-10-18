# Docker, proxies and hostnames

NodeUI runs inside your app's process, so it works in a container the same way it works on your laptop. There is nothing to run next to it and no image to pull. The only thing that changes is who the console sees as the client.

## Why a container needs extra setup

The console is loopback-only. Outside Docker the browser connects from `127.0.0.1`, so it is accepted. Inside a container the browser's request reaches your app through the Docker network, so the app sees the **Docker bridge gateway** (for example `172.17.0.1`) as the client. The guard rejects it with `403 nodeui is loopback-only`.

You fix this by allow-listing that network, and you keep the port published on your own machine only:

```text
browser ──► 127.0.0.1:3000 (host) ──► Docker bridge ──► container :3000 ──► NodeUI guard
                                       source IP 172.x                      allowedRemoteAddresses must match
```

## Step by step

### 1. Install NodeUI in the project

```bash
npm install --save-dev @singhak/nodeui-express   # or -fastify / -nestjs / -koa / -hapi / -hono / -http
```

### 2. Mount it and allow the bridge

```typescript
import { nodeui } from '@singhak/nodeui-express';

const { middleware, server } = nodeui({
  allowedRemoteAddresses: ['172.16.0.0/12'], // Docker bridge networks
  authToken: process.env.NODEUI_TOKEN, // keep a token on
});
app.use(middleware);
app.listen(3000, '0.0.0.0', () => server.mark('listening'));
```

Listen on `0.0.0.0` inside the container. A server bound to `127.0.0.1` inside a container cannot be reached through a published port. This is separate from NodeUI's own host check.

The same settings work without code changes through environment variables, see [Environment variables](#environment-variables).

### 3. Write the Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
ENV NODE_ENV=development
CMD ["node", "server.js"]
```

Keep `NODE_ENV` out of `production` for this image. NodeUI is off in production unless you set `NODEUI_ENABLED=true` (see [Production images](#production-images)).

### 4. Run it with the port published on loopback only

```bash
docker run --rm \
  -p 127.0.0.1:3000:3000 \
  -e NODEUI_TOKEN=change-me \
  -e NODEUI_ALLOWED_REMOTE=172.16.0.0/12 \
  my-app
```

Use `127.0.0.1:3000:3000`, not `3000:3000`. The short form listens on every interface of your machine, so anyone on your network could reach the console (the token would then be the only barrier).

### 5. Open the console

Open `http://127.0.0.1:3000/nodeui/?token=change-me` once. NodeUI sets an HttpOnly cookie and redirects to `/nodeui/`, so you stay signed in afterwards.

## Docker Compose

```yaml
services:
  api:
    build: .
    ports:
      - '127.0.0.1:3000:3000'
    environment:
      NODE_ENV: development
      NODEUI_TOKEN: ${NODEUI_TOKEN:?set NODEUI_TOKEN in your shell or .env}
      NODEUI_ALLOWED_REMOTE: 172.16.0.0/12
      NODEUI_HEAP_SNAPSHOT_DIR: /snapshots
      NODEUI_PERSIST_FILE: /data/nodeui.ndjson
    volumes:
      - ./.nodeui/snapshots:/snapshots
      - ./.nodeui/data:/data
```

The two volumes are optional. They let heap snapshots and the request journal outlive the container (see [Files written inside the container](#files-written-inside-the-container)).

## Attach without changing code

If you cannot edit the app, the CLI attaches NodeUI to any Node command. In a container, make it the start command and pass settings as environment variables:

```dockerfile
RUN npm install --save-dev @singhak/nodeui-cli
CMD ["npx", "nodeui", "attach", "--", "node", "server.js"]
```

```bash
docker run --rm -p 127.0.0.1:3000:3000 \
  -e NODEUI_TOKEN=change-me \
  -e NODEUI_ALLOWED_REMOTE=172.16.0.0/12 \
  my-app
```

## Finding the right address range

`172.16.0.0/12` covers the default Docker bridge networks (`172.17.0.0/16` and the networks Compose creates). Docker Desktop on Windows or macOS can present a different gateway, for example in `192.168.65.0/24`.

If you still get `403` with the range above, check which gateway your network uses and allow that instead:

```bash
docker network inspect bridge --format '{{(index .IPAM.Config 0).Subnet}}'
```

For Compose, use the network name Compose created (`docker network ls`). Allow the narrowest range that works. Entries can be exact IPs, IPv4 CIDRs, or IPv6 CIDRs such as `fd00::/8`. An invalid entry is reported at startup and never matches.

## Using other NodeUI tools against a container

The `nodeui dashboard`, `nodeui check` and `nodeui mcp` commands talk to the console over HTTP. When they run on your machine and the app runs in a container, their requests also arrive from the bridge, so the same `allowedRemoteAddresses` and token apply:

```bash
npx @singhak/nodeui-cli check --max-p99 300 "http://127.0.0.1:3000?token=change-me"
npx @singhak/nodeui-cli dashboard "api=http://127.0.0.1:3000?token=change-me"
```

A `?token=` on the URL becomes the access token for that target. See [CLI, attach and MCP](./cli).

## Behind a reverse proxy or a custom hostname

| Situation                                          | Setting                                                                 |
| :------------------------------------------------- | :---------------------------------------------------------------------- |
| You reach the app as `dev.myapp.test`              | `allowedHosts: ['dev.myapp.test']` (`NODEUI_ALLOWED_HOSTS`)             |
| A web page on another origin calls the console     | `allowedOrigins: ['https://dev.myapp.test']` (`NODEUI_ALLOWED_ORIGINS`) |
| A local proxy adds `X-Forwarded-*` headers         | `trustProxy: true` (`NODEUI_TRUST_PROXY=true`), and keep a token on     |
| You need extra client addresses besides the bridge | add them to `allowedRemoteAddresses`                                    |

Requests carrying `X-Forwarded-*`, `Forwarded` or `X-Real-IP` headers are rejected unless `trustProxy` is on.

## Environment variables

| Variable                   | Same as                  | Example                  |
| :------------------------- | :----------------------- | :----------------------- |
| `NODEUI_ENABLED`           | `enabled`                | `true`                   |
| `NODEUI_TOKEN`             | `authToken`              | `change-me`              |
| `NODEUI_ALLOWED_REMOTE`    | `allowedRemoteAddresses` | `172.16.0.0/12`          |
| `NODEUI_ALLOWED_HOSTS`     | `allowedHosts`           | `dev.myapp.test`         |
| `NODEUI_ALLOWED_ORIGINS`   | `allowedOrigins`         | `https://dev.myapp.test` |
| `NODEUI_TRUST_PROXY`       | `trustProxy`             | `true`                   |
| `NODEUI_HEAP_SNAPSHOT_DIR` | `heapSnapshotDir`        | `/snapshots`             |
| `NODEUI_PERSIST_FILE`      | `persist`                | `/data/nodeui.ndjson`    |
| `NODEUI_RUNS_FILE`         | `runsFile`               | `/data/nodeui-runs.json` |

Lists are comma-separated. See the [configuration reference](../reference/configuration) for everything else.

## Files written inside the container

- **Heap snapshots** go to a private directory under the container's temp dir (`/tmp/nodeui-heap`) and the console shows that path, which is **inside the container**. Either copy the file out with `docker cp <container>:<path> .`, or set `NODEUI_HEAP_SNAPSHOT_DIR` to a mounted volume. A snapshot contains every secret in memory, so delete it afterwards.
- **The persist journal and saved load-test runs** live in memory only unless you set `NODEUI_PERSIST_FILE` / `NODEUI_RUNS_FILE`. Point them at a mounted volume if you want them to survive `docker compose down`. Keep these files out of version control.

## Production images

NodeUI is off when `NODE_ENV=production`. That is the right default for a production image, so build one without it:

- install NodeUI as a dev dependency and prune it from the production image, and
- guard the import so the app still starts when the package is missing (see step 2 of [Getting started](./getting-started)).

If you really need the console in a production-like container (staging, a debugging session), set `NODEUI_ENABLED=true`, keep a token on, and keep the port bound to loopback or a private network. Do not expose it to the internet.

## Troubleshooting

| Symptom                                               | Cause and fix                                                                                |
| :---------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| `403 nodeui is loopback-only`                         | The client is the Docker bridge. Add its range to `allowedRemoteAddresses`.                  |
| `403 proxied requests are rejected`                   | A proxy added `X-Forwarded-*`. Set `trustProxy: true` and use a token.                       |
| `403 Host "..." is not allowed`                       | You use a hostname other than localhost. Add it to `allowedHosts`.                           |
| `403 cross-origin requests to nodeui are rejected`    | The page is on another origin. Add it to `allowedOrigins`.                                   |
| `401 a valid nodeui token is required`                | Open `/nodeui/?token=...` once, or send `Authorization: Bearer ...`.                         |
| Connection refused or empty reply                     | The app listens on `127.0.0.1` inside the container. Listen on `0.0.0.0`.                    |
| Startup log says `not attached` or the console is 404 | `NODE_ENV=production`. Use a non-production `NODE_ENV` or set `NODEUI_ENABLED=true`.         |
| Heap snapshot path does not exist on your machine     | The path is inside the container. Use `docker cp` or `NODEUI_HEAP_SNAPSHOT_DIR` on a volume. |
