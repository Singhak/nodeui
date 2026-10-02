import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { QueriesProvider, normalizeSql, type DriverLoader } from '../src/providers/queries';
import { createNodeUI } from '../src/server';
import { runWithRequestId } from '../src/context';

function fakeDrivers() {
  class PgClient {
    // promise style, rowCount result
    query(text: unknown, _values?: unknown, cb?: (e: Error | null, r?: unknown) => void) {
      const sql = typeof text === 'string' ? text : (text as { text: string }).text;
      const fail = sql.includes('boom');
      if (typeof _values === 'function') cb = _values as typeof cb;
      if (cb) {
        setTimeout(() => (fail ? cb?.(new Error('syntax')) : cb?.(null, { rowCount: 3 })), 1);
        return undefined;
      }
      return fail
        ? Promise.reject(new Error('syntax'))
        : Promise.resolve({ rowCount: 3, rows: [{}, {}, {}] });
    }
  }
  class MysqlConnection {
    query(sql: unknown, _v?: unknown) {
      // event-emitter style (no callback)
      const q = new EventEmitter();
      setTimeout(() => q.emit('end'), 1);
      void sql;
      return q;
    }
    execute(sql: string, cb: (e: Error | null, rows?: unknown) => void) {
      void sql;
      setTimeout(() => cb(null, [{ a: 1 }, { a: 2 }]), 1);
    }
  }
  const pg = { Client: PgClient };
  const mysql2 = { Connection: MysqlConnection };
  const load: DriverLoader = (name) => (name === 'pg' ? pg : name === 'mysql2' ? mysql2 : null);
  return { pg, mysql2, load };
}

describe('normalizeSql', () => {
  it('collapses literals and IN lists', () => {
    expect(normalizeSql("SELECT * FROM t WHERE id = 42 AND n = 'a''b' AND x IN (1, 2, 3)")).toBe(
      'select * from t where id = ? and n = ? and x in (?)',
    );
  });
});

describe('QueriesProvider driver interception', () => {
  it('records pg queries in promise and callback style, with errors and row counts', async () => {
    const { pg, load } = fakeDrivers();
    const original = pg.Client.prototype.query;
    const provider = new QueriesProvider({ size: 50, slowQueryMs: 100, loader: load });
    provider.start();
    try {
      const client = new pg.Client();
      const res = (await client.query('select 1')) as { rowCount: number };
      expect(res.rowCount).toBe(3); // return value untouched
      await expect(client.query('boom')).rejects.toThrow('syntax');
      await new Promise<void>((resolve) => client.query('select 2', [], () => resolve()));
      await new Promise((r) => setTimeout(r, 5));
      const { entries, failed } = provider.get().data;
      expect(entries.map((e) => e.sql)).toEqual(['select 1', 'boom', 'select 2']);
      expect(entries[0]).toMatchObject({ system: 'pg', rowCount: 3 });
      expect(entries[1]?.error).toBe('syntax');
      expect(failed).toBe(1);
    } finally {
      provider.stop();
    }
    expect(pg.Client.prototype.query).toBe(original);
  });

  it('records mysql2 emitter-style and callback execute calls', async () => {
    const { mysql2, load } = fakeDrivers();
    const original = mysql2.Connection.prototype.query;
    const provider = new QueriesProvider({ size: 50, slowQueryMs: 100, loader: load });
    provider.start();
    try {
      const conn = new mysql2.Connection();
      conn.query('select * from users');
      await new Promise<void>((resolve) => conn.execute('select * from posts', () => resolve()));
      await new Promise((r) => setTimeout(r, 10));
      const { entries } = provider.get().data;
      expect(entries.map((e) => e.sql).sort()).toEqual([
        'select * from posts',
        'select * from users',
      ]);
      expect(entries.find((e) => e.sql.includes('posts'))?.rowCount).toBe(2);
    } finally {
      provider.stop();
    }
    expect(mysql2.Connection.prototype.query).toBe(original);
  });

  it('flags N+1 patterns per request and slow queries', async () => {
    const { pg, load } = fakeDrivers();
    const provider = new QueriesProvider({ size: 50, slowQueryMs: 0.0001, loader: load });
    provider.start();
    try {
      const client = new pg.Client();
      await runWithRequestId(7, async () => {
        for (let i = 1; i <= 6; i += 1)
          await client.query(`select * from posts where user_id = ${i}`);
        await client.query('select now()');
      });
      await runWithRequestId(8, async () => {
        await client.query('select * from posts where user_id = 1');
      });
      const data = provider.get().data;
      expect(data.nPlusOneGroups).toBe(1);
      const flagged = data.entries.filter((e) => e.nPlusOne);
      expect(flagged).toHaveLength(6);
      expect(flagged.every((e) => e.requestId === 7 && e.repeats === 6)).toBe(true);
      expect(data.entries.find((e) => e.requestId === 8)?.nPlusOne).toBeUndefined();
      expect(data.slow).toBeGreaterThan(0);
    } finally {
      provider.stop();
    }
  });

  it('skips drivers that are not installed and never throws', () => {
    const provider = new QueriesProvider({ size: 5, slowQueryMs: 100, loader: () => null });
    expect(() => {
      provider.start();
      provider.stop();
    }).not.toThrow();
  });
});

describe('server query helpers', () => {
  it('recordQuery and trackPrisma feed the queries panel', async () => {
    const nodeui = createNodeUI({ env: { NODE_ENV: 'development' } });
    let listener: ((e: { query: string; duration: number }) => void) | undefined;
    nodeui.trackPrisma({ $on: (_event, cb) => (listener = cb) });
    listener?.({ query: 'SELECT 1', duration: 3 });
    nodeui.recordQuery({ system: 'sequelize', sql: 'SELECT 2', durationMs: 150 });
    const off = createNodeUI({ enabled: false });
    off.recordQuery({ system: 'x', sql: 'ignored', durationMs: 1 });
    const mw = nodeui.middleware();
    const app = createServer((req, res) => mw(req, res, () => res.writeHead(404).end()));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
      const body = (await (await fetch(`${base}/nodeui/api/queries`)).json()) as {
        data: { total: number; slow: number; entries: Array<{ system: string; slow: boolean }> };
      };
      expect(body.data.total).toBe(2);
      expect(body.data.slow).toBe(1);
      expect(body.data.entries.map((e) => e.system)).toEqual(['prisma', 'sequelize']);
    } finally {
      nodeui.shutdown();
      off.shutdown();
      app.closeAllConnections?.();
      await new Promise<void>((r) => app.close(() => r()));
    }
  });
});
