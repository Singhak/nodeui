import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = join(__dirname, '..', 'dist');
const built = existsSync(join(dist, 'index.mjs')) && existsSync(join(dist, 'index.cjs'));

type Factory = (opts: object) => {
  middleware(): (req: unknown, res: unknown, next: () => void) => void;
  shutdown(): void;
};

async function serveIndex(createNodeUI: Factory): Promise<string> {
  const nodeui = createNodeUI({ env: { NODE_ENV: 'development' } });
  const mw = nodeui.middleware();
  const app = createServer((req, res) => mw(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/nodeui/`);
    expect(res.status).toBe(200);
    return await res.text();
  } finally {
    nodeui.shutdown();
    app.closeAllConnections?.();
    await new Promise<void>((r) => app.close(() => r()));
  }
}

// Skipped when `npm run build` has not run yet (CI tests before building).
describe.skipIf(!built)('built bundles resolve the static console', () => {
  it('ESM build serves index.html', async () => {
    const mod = (await import(pathToFileURL(join(dist, 'index.mjs')).href)) as {
      createNodeUI: Factory;
    };
    expect(await serveIndex(mod.createNodeUI)).toContain('<div id="root"></div>');
  });

  it('CJS build serves index.html', async () => {
    const mod = createRequire(__filename)(join(dist, 'index.cjs')) as { createNodeUI: Factory };
    expect(await serveIndex(mod.createNodeUI)).toContain('<div id="root"></div>');
  });
});
