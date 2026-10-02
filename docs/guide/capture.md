# Capture and compatibility

By default NodeUI records outgoing HTTP calls, database queries and `console.*` output **from startup** into bounded ring buffers, so the request that just failed is already there when you open the console. The hooks cost a few microseconds per captured call (`npm run bench:hooks`: about 6 µs per outgoing `http.request` and 0.4 µs per `console.log` on the reference machine). Set `capture: 'lazy'` (or `NODEUI_CAPTURE=lazy`) to install the hooks only while a panel is open and remove them after a minute idle; the cost is that earlier activity is not recorded.

**Working next to other instrumentation.** NodeUI wraps `http.request`/`http.get` (and `https`), `console.*`, and the `pg` / `mysql2` query methods; `fetch` is observed through `diagnostics_channel` without patching. OpenTelemetry auto-instrumentation, Sentry and APM agents patch some of the same functions. NodeUI is written to compose with them:

- It only restores a function it still owns. If another tool wrapped on top of NodeUI, stopping NodeUI leaves that wrapper in place, and its own retired wrapper becomes a passthrough that no longer records (`packages/core/test/compat.test.ts`).
- Wrappers call the previous function, so every layer still sees the call.
- If a call is recorded twice or goes missing in another tool, set `capture: 'lazy'` or `NODEUI_ENABLED=false` to rule NodeUI out, and open an issue.
- Tested against the real `@opentelemetry/instrumentation-http` in a separate process (`packages/core/test/otel-compat.test.ts`): both see every call in either install order, stopping NodeUI leaves OpenTelemetry tracing, disabling OpenTelemetry leaves NodeUI recording, and restarting NodeUI neither double-records nor drops OpenTelemetry spans.
- Not yet tested against Sentry or Datadog agents, which also patch `http`; the same rules apply, but treat that as unverified.
