/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON assertions */
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Persistence } from '../src/persistence';
import { createNodeUI, type NodeUIOptions } from '../src/server';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'nodeui-persist-'));

async function session(
  options: NodeUIOptions,
  fn: (ctx: {
    base: string;
    server: ReturnType<typeof createNodeUI>;
    api: (p: string) => Promise<{ data: any }>;
  }) => Promise<void>,
): Promise<void> {
  const server = createNodeUI({ env: { NODE_ENV: 'development' }, ...options });
  const mw = server.middleware();
  const app = createServer((req, res) => mw(req, res, () => res.writeHead(200).end('ok')));
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const api = async (p: string) => (await (await fetch(base + '/nodeui/api' + p)).json()) as any;
  try {
    await fn({ base, server, api });
  } finally {
    server.shutdown();
    app.closeAllConnections?.();
    await new Promise<void>((r) => app.close(() => r()));
  }
}

describe('persistence', () => {
  it('restores requests, queries, outgoing calls and errors after a restart', async () => {
    const file = join(tmp(), 'journal.ndjson');
    await session({ persist: file }, async ({ base, server }) => {
      await fetch(base + '/a?token=s3cret', { headers: { authorization: 'Bearer abc' } });
      await fetch(base + '/b');
      server.recordError(new Error('db 5 down'), { route: '/b' });
      server.recordQuery({ system: 'pg', sql: 'SELECT 1', durationMs: 3 });
    });
    expect(existsSync(file)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);

    await session({ persist: file }, async ({ base, api }) => {
      const before = (await api('/requests')).data;
      expect(before.entries.map((e: { path: string }) => e.path)).toEqual(['/a', '/b']);
      expect(before.entries[0].query.token).toBe('[REDACTED]');
      expect((await api('/errors')).data.groups[0]).toMatchObject({
        message: 'db 5 down',
        lastRoute: '/b',
        count: 1,
      });
      expect((await api('/queries')).data.entries[0]).toMatchObject({ sql: 'SELECT 1' });
      // ids keep counting from the restored maximum
      await fetch(base + '/c');
      const after = (await api('/requests')).data.entries;
      expect(after.map((e: { id: number }) => e.id)).toEqual([1, 2, 3]);
    });
  });

  it('never writes credentials to the journal', async () => {
    const file = join(tmp(), 'j.ndjson');
    await session({ persist: file }, async ({ base }) => {
      await fetch(base + '/x?api_key=hunter2', { headers: { cookie: 'sid=topsecret' } });
    });
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('topsecret');
  });

  it('is off by default and does nothing when the console is disabled', async () => {
    const dir = tmp();
    await session({}, async ({ base }) => {
      await fetch(base + '/a');
    });
    const server = createNodeUI({ enabled: false, persist: join(dir, 'never.ndjson') });
    server.shutdown();
    expect(existsSync(join(dir, 'never.ndjson'))).toBe(false);
  });

  it('tolerates a corrupt or torn journal', async () => {
    const file = join(tmp(), 'j.ndjson');
    writeFileSync(
      file,
      [
        'not json',
        JSON.stringify({
          kind: 'request',
          data: {
            id: 9,
            method: 'GET',
            path: '/old',
            status: 200,
            durationMs: 1,
            timestampMs: 1,
            ip: '::1',
          },
        }),
        '{"kind":"requ',
      ].join('\n'),
    );
    await session({ persist: file }, async ({ api }) => {
      const entries = (await api('/requests')).data.entries;
      expect(entries.map((e: { path: string }) => e.path)).toEqual(['/old']);
    });
  });

  it('rotates when the file exceeds maxBytes and reads both generations', () => {
    const file = join(tmp(), 'r.ndjson');
    const first = new Persistence(file, 200);
    for (let i = 0; i < 20; i += 1) first.append('query', { n: i, pad: 'x'.repeat(30) });
    first.close();
    const second = new Persistence(file, 200);
    for (let i = 20; i < 40; i += 1) second.append('query', { n: i, pad: 'x'.repeat(30) });
    second.close();
    expect(existsSync(`${file}.1`)).toBe(true);
    const loaded = new Persistence(file, 200).load().map((r) => (r.data as { n: number }).n);
    expect(loaded.length).toBeGreaterThan(0);
    expect([...loaded].sort((a, b) => a - b)).toEqual(loaded); // chronological
    expect(loaded[loaded.length - 1]).toBe(39);
  });
});
