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
    version: '0.3.0',
    port,
    // masked automatically:
    DATABASE_URL: 'postgres://app:s3cret@localhost:5432/demo',
    apiToken: 'demo-token-123',
  },
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

app.use(express.json());
app.use(middleware);

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
    const paths = ['/hello', '/users/42', '/slow', '/proxy', '/boom', '/hello', '/missing'];
    let i = 0;
    setInterval(() => {
      const path = paths[i++ % paths.length]!;
      void fetch(base + path).catch(() => undefined);
      if (path === '/slow') console.warn('[demo-express] slow endpoint hit');
      if (path === '/boom') console.error('[demo-express] token=abc123 failed for /boom');
    }, 250).unref();
  }
});
