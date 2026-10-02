# Try the demos

Run the built-in demo playgrounds in under a minute:

```bash
# Clone and install
git clone https://github.com/Singhak/nodeui.git
cd nodeui
npm install
npm run build

# Start Express Demo -> Open http://127.0.0.1:3000/nodeui
npm run demo:express

# OR Start NestJS Demo -> Open http://127.0.0.1:3001/nodeui
npm run demo:nestjs
```

Set `DEMO_TRAFFIC=1` for a self-generating stream of requests, errors and outgoing calls so every panel has live data (PowerShell: `$env:DEMO_TRAFFIC=1; npm run demo:express`). Both demos exercise the 0.4.0 features: grouped **Errors** (`/crash/:id` collapses into one entry with a count), **Queries** with an N+1 (`/orders`) and a slow statement (`/report`), a failing **outgoing** call (`/flaky`), route patterns (`/users/:id`), request detail with a masked body and "Copy as curl" (`POST /orders`), and a per-request timeline in the Requests drawer. The Express demo also shows `persist` (stop it and start it again; the history comes back), `healthChecks`, a custom `plugins` panel and a curated `env`; the NestJS demo shows `NodeUILogger` and the error interceptor.

> Body capture needs NodeUI to see the stream before your body parser: register `middleware` before `express.json()`. Nest parses request bodies before module middleware runs, so there only headers, query and response bodies are captured.
