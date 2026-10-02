'use strict';
// Runs in its own process, like a real app: OpenTelemetry's http instrumentation hooks
// `require()`, so the scenarios must not share a process with each other or the test runner.
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { createNodeUI } = require(path.join(root, 'dist', 'index.cjs'));

const scenario = process.argv[2];
const spans = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
let instrumentation;
let nodeui;
let front;

function startOtel() {
  instrumentation = new HttpInstrumentation();
  instrumentation.setTracerProvider(provider);
  instrumentation.enable();
}
function startNodeUI() {
  nodeui = createNodeUI({ env: { NODE_ENV: 'development' } });
}

let http = require('node:http');

function call(port, p) {
  return new Promise((resolve, reject) => {
    http
      .request({ host: '127.0.0.1', port, path: p }, (res) => {
        res.resume();
        res.on('end', resolve);
      })
      .on('error', reject)
      .end();
  });
}

async function nodeuiSaw(p) {
  const res = await fetch(`http://127.0.0.1:${front.address().port}/nodeui/api/outgoing`);
  const body = await res.json();
  return body.data.entries.filter((e) => e.url.endsWith(p)).length;
}

function otelSaw(p) {
  return spans
    .getFinishedSpans()
    .filter(
      (s) =>
        s.kind === 2 &&
        String(s.attributes['url.full'] ?? s.attributes['http.url'] ?? '').endsWith(p),
    ).length;
}

async function main() {
  const upstream = http.createServer((_q, r) => r.end('ok'));
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const port = upstream.address().port;
  const result = {};

  if (scenario === 'otel-first') {
    startOtel();
    startNodeUI();
  } else {
    startNodeUI();
    if (scenario !== 'otel-never') startOtel();
  }
  // OpenTelemetry patches on the first `require('http')` after it is enabled.
  http = require('node:http');
  front = http.createServer((req, res) => nodeui.middleware()(req, res, () => res.end()));
  await new Promise((r) => front.listen(0, '127.0.0.1', r));

  await call(port, '/one');
  result.one = { otel: otelSaw('/one'), nodeui: await nodeuiSaw('/one') };

  if (scenario === 'restart') {
    nodeui.shutdown();
    startNodeUI(); // a second NodeUI instance on top of the retired wrapper
    front.close();
    front = http.createServer((req, res) => nodeui.middleware()(req, res, () => res.end()));
    await new Promise((r) => front.listen(0, '127.0.0.1', r));
    await call(port, '/two');
    result.two = { otel: otelSaw('/two'), nodeui: await nodeuiSaw('/two') };
  }

  if (scenario === 'otel-first') {
    // NodeUI stops while OpenTelemetry's wrapper sits on top of it.
    nodeui.shutdown();
    await call(port, '/after-stop');
    result.afterStop = { otel: otelSaw('/after-stop') };
  }

  if (scenario === 'nodeui-first') {
    // OpenTelemetry is disabled while NodeUI's wrapper sits on top of it.
    instrumentation.disable();
    await call(port, '/after-otel-disable');
    result.afterOtelDisable = { nodeui: await nodeuiSaw('/after-otel-disable') };
  }

  process.stdout.write(JSON.stringify(result));
  nodeui.shutdown();
  front.close();
  upstream.close();
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
