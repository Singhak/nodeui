import express from 'express';
import { nodeui } from '@singhak/nodeui-express';

const app = express();
const { middleware, server } = nodeui({
  config: { appName: 'demo-express', version: '0.1.0', port: Number(process.env.PORT ?? 3000) },
});

app.use(express.json());
app.use(middleware);

app.get('/hello', (_req, res) => {
  res.json({ message: 'hello from express demo', via: 'nodeui demo' });
});

app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id, via: 'nodeui demo' });
});

app.get('/slow', (_req, res) => {
  setTimeout(() => res.json({ message: 'slow response finished' }), 200);
});

app.get('/boom', () => {
  throw new Error('intentional demo failure');
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 3000);
const host = '127.0.0.1';

app.listen(port, host, () => {
  server.mark('listening');
  server.addLogSource({ level: 'info', message: 'demo-express listening on port ' + port });
  console.warn('[demo-express] log interception is active while the Logs panel is open');
  console.log(`[demo-express] listening on http://${host}:${port}`);
});
