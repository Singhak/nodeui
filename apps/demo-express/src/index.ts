import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const port = Number(process.env.PORT ?? 3000);
const host = '127.0.0.1';
const base = `http://${host}:${port}`;

const jobs = { waiting: 3, active: 1, completed: 128, failed: 2 };

const app = express();
const { middleware, server, errorHandler } = nodeui({
  // A curated environment for the Environment panel (defaults to process.env).
  // Values under secret-looking keys are masked automatically.
  env: {
    NODE_ENV: 'development',
    PORT: String(port),
    APP_NAME: 'demo-express',
    LOG_LEVEL: 'debug',
    DATABASE_URL: 'postgres://app:s3cret@localhost:5432/demo',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'super-secret-signing-key',
    STRIPE_API_KEY: 'sk_test_51Hxxxxxxxxxxxxxxxx',
  },
  config: {
    appName: 'demo-express',
    version: '0.4.0',
    port,
    // masked automatically:
    DATABASE_URL: 'postgres://app:s3cret@localhost:5432/demo',
    apiToken: 'demo-token-123',
  },
  // Query string and headers are captured by default; bodies are opt-in (masked, size-capped).
  captureRequestDetail: { bodies: true, maxBodyBytes: 2048 },
  // Requests, errors and queries survive a restart (try: stop the demo and start it again).
  persist: join(tmpdir(), 'nodeui-demo-express.ndjson'),
  slowQueryMs: 50,
  // Dependency checks shown in the Health panel.
  healthChecks: {
    postgres: async () => new Promise((resolve) => setTimeout(resolve, 12)),
    redis: async () => new Promise((resolve) => setTimeout(resolve, 3)),
  },
  // A custom panel: any provider with an id and get().
  plugins: [
    {
      id: 'jobs',
      title: 'Job Queue',
      get: () => ({
        ok: true,
        data: Object.entries(jobs).map(([state, count]) => ({ state, count })),
      }),
    },
  ],
});

// Register NodeUI before body parsers so request bodies can be captured.
app.use(middleware);
app.use(express.json());

app.get('/hello', (_req, res) => {
  res.json({ message: 'hello from express demo', via: 'nodeui demo' });
});

app.get('/users/:id', (req, res) => {
  // Stand-in for a real DB call (pg and mysql2 are captured automatically).
  server.recordQuery({
    system: 'demo-db',
    sql: `SELECT * FROM users WHERE id = ${req.params.id}`,
    durationMs: 2 + Math.random() * 6,
    rowCount: 1,
  });
  res.json({ id: req.params.id, via: 'nodeui demo' });
});

// POST with a JSON body: open it in Requests to see the captured body, the masked
// headers and "Copy as curl".
app.post('/orders', (req, res) => {
  console.log('creating order for', req.body?.customer ?? 'unknown');
  server.recordQuery({
    system: 'demo-db',
    sql: 'INSERT INTO orders (customer, total) VALUES ($1, $2)',
    durationMs: 8,
    rowCount: 1,
  });
  res.status(201).json({ id: 1001, customer: req.body?.customer, token: 'order-token-xyz' });
});

// Classic N+1: one query for the list, then one per row. The Queries panel flags it
// and the request drawer shows all of them in its timeline.
app.get('/orders', (_req, res) => {
  server.recordQuery({
    system: 'demo-db',
    sql: 'SELECT id FROM orders',
    durationMs: 3,
    rowCount: 6,
  });
  for (let id = 1; id <= 6; id++) {
    server.recordQuery({
      system: 'demo-db',
      sql: `SELECT * FROM order_items WHERE order_id = ${id}`,
      durationMs: 1.5 + id / 4,
      rowCount: 3,
    });
  }
  res.json({ orders: 6 });
});

// A statement over slowQueryMs, flagged as slow.
app.get('/report', (_req, res) => {
  server.recordQuery({
    system: 'demo-db',
    sql: 'SELECT region, sum(total) FROM orders GROUP BY region',
    durationMs: 140,
    rowCount: 12,
  });
  res.json({ rows: 12 });
});

// An outgoing call that fails, attributed to this request in the timeline.
app.get('/flaky', async (_req, res) => {
  try {
    await fetch('http://127.0.0.1:9/unreachable');
    res.json({ ok: true });
  } catch {
    res.status(502).json({ error: 'upstream unavailable' });
  }
});

app.get('/slow', (_req, res) => {
  setTimeout(() => res.json({ message: 'slow response finished' }), 200);
});

// Makes an outgoing HTTP call so the Outgoing panel has something to show.
app.get('/proxy', async (_req, res) => {
  const upstream = await fetch(`${base}/hello`);
  res.json({ upstreamStatus: upstream.status });
});

app.get('/boom', () => {
  throw new Error('intentional demo failure');
});

// Errors with the same shape are grouped: 42 and 43 below become one entry with a count.
app.get('/crash/:id', (req) => {
  throw new TypeError(`cannot read plan of customer ${req.params.id}`);
});

// Feeds the Errors panel; place it after the routes.
app.use(errorHandler);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});

app.listen(port, host, () => {
  server.mark('listening');
  server.addLogSource({ level: 'info', message: 'demo-express listening on port ' + port });
  console.warn('[demo-express] log interception is active while the Logs panel is open');
  console.log(`[demo-express] listening on ${base}  ->  console at ${base}/nodeui`);

  // DEMO_TRAFFIC=1 keeps generating requests so the panels have live data.
  if (process.env.DEMO_TRAFFIC === '1') {
    const paths = [
      '/hello',
      '/users/42',
      '/orders',
      '/slow',
      'POST /orders',
      '/proxy',
      '/boom',
      '/report',
      '/crash/42',
      '/flaky',
      '/users/43',
      '/crash/43',
      '/missing',
    ];
    let i = 0;
    setInterval(() => {
      const path = paths[i++ % paths.length]!;
      const post = path.startsWith('POST ');
      void fetch(base + path.replace('POST ', ''), {
        method: post ? 'POST' : 'GET',
        headers: post
          ? { 'content-type': 'application/json', authorization: 'Bearer demo-secret' }
          : undefined,
        body: post
          ? JSON.stringify({ customer: 'Ada', card: '4111-1111-1111-1111', password: 'hunter2' })
          : undefined,
      }).catch(() => undefined);
      if (path === '/slow') console.warn('[demo-express] slow endpoint hit');
      if (path === '/boom') console.error('[demo-express] token=abc123 failed for /boom');
    }, 250).unref();
  }
});
