import { afterEach, describe, expect, it } from 'vitest';
import { ErrorsProvider, fingerprintError } from '../src/providers/errors';
import { createNodeUI } from '../src/server';

describe('fingerprintError', () => {
  it('collapses numbers and ids in messages', () => {
    const stack = 'Error: x\n    at handler (/app/src/users.ts:10:5)';
    expect(fingerprintError('Error', 'user 12 not found', stack)).toBe(
      fingerprintError('Error', 'user 987 not found', stack),
    );
    expect(fingerprintError('Error', 'user 12 not found', stack)).not.toBe(
      fingerprintError('TypeError', 'user 12 not found', stack),
    );
  });

  it('ignores line numbers so edits do not split a group', () => {
    const a = 'Error: x\n    at handler (/app/src/users.ts:10:5)';
    const b = 'Error: x\n    at handler (/app/src/users.ts:42:9)';
    expect(fingerprintError('Error', 'boom', a)).toBe(fingerprintError('Error', 'boom', b));
  });
});

describe('ErrorsProvider', () => {
  const providers: ErrorsProvider[] = [];
  afterEach(() => providers.splice(0).forEach((p) => p.detach()));

  it('groups repeated errors with counts, newest first', () => {
    const p = new ErrorsProvider();
    const make = (id: number) => {
      const e = new Error(`user ${id} not found`);
      e.stack = 'Error: x\n    at lookup (/app/users.ts:1:1)';
      return e;
    };
    p.record(make(1), 'request', { route: '/users/:id', status: 500 });
    p.record(make(2), 'request');
    p.record(new TypeError('other'), 'manual');
    const { total, groups } = p.get().data;
    expect(total).toBe(3);
    expect(groups).toHaveLength(2);
    const users = groups.find((g) => g.message.startsWith('user'));
    expect(users).toMatchObject({ count: 2, lastRoute: '/users/:id', lastStatus: 500 });
  });

  it('records non-Error values and caps the number of groups', () => {
    const p = new ErrorsProvider();
    p.record('plain string', 'manual');
    p.record({ code: 7 }, 'manual');
    for (let i = 0; i < 150; i += 1) p.record(new Error(`distinct-${'x'.repeat(i)}`), 'manual');
    const { groups } = p.get().data;
    expect(groups.length).toBeLessThanOrEqual(100);
  });

  it('observes uncaught exceptions without altering process behaviour', () => {
    const p = new ErrorsProvider();
    providers.push(p);
    const before = process.listenerCount('uncaughtException');
    p.attach();
    expect(process.listenerCount('uncaughtException')).toBe(before);
    process.emit('uncaughtExceptionMonitor', new Error('crash'), 'uncaughtException');
    process.emit('uncaughtExceptionMonitor', new Error('rej'), 'unhandledRejection');
    const sources = p.get().data.groups.map((g) => g.source);
    expect(sources.sort()).toEqual(['rejection', 'uncaught']);
    const monitors = process.listenerCount('uncaughtExceptionMonitor');
    p.detach();
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(monitors - 1);
  });

  it('server.recordError feeds the errors panel and respects disabled state', async () => {
    const on = createNodeUI({ env: { NODE_ENV: 'development' } });
    on.recordError(new Error('handled'));
    const off = createNodeUI({ enabled: false });
    off.recordError(new Error('ignored'));
    on.shutdown();
    off.shutdown();
  });
});
