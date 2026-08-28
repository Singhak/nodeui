import { describe, expect, it } from 'vitest';
import { extractRoutes, RoutesProvider } from '../src/providers/routes';
import type { NodeUIConfig, ProviderContext } from '../src/types';

function makeCtx(store: Record<string, unknown> = {}): ProviderContext {
  const config: NodeUIConfig = {
    path: '/nodeui',
    host: '127.0.0.1',
    port: 3000,
    requestLogSize: 500,
    logSize: 500,
    pollIntervalMs: 2000,
    enabled: true,
    activationReason: 'test',
    maskSecrets: true,
    inactivityTimeoutMs: 60_000,
    confirmTtlMs: 60_000,
    heapSnapshotDir: '/tmp',
  };
  return { config, env: {}, store };
}

function layer(route: { path: string; methods: Record<string, boolean>; handler: string }) {
  return {
    name: 'bound dispatch',
    route: {
      path: route.path,
      methods: route.methods,
      stack: [{ handle: { name: route.handler } }],
    },
  };
}

describe('extractRoutes', () => {
  it('walks the router stack and extracts method, path, and handler', () => {
    const stack = [
      { name: 'query', handle: () => undefined },
      layer({ path: '/hello', methods: { get: true }, handler: 'helloHandler' }),
      layer({ path: '/users/:id', methods: { get: true, post: true }, handler: 'userHandler' }),
    ];
    const routes = extractRoutes({ stack });
    expect(routes).toEqual([
      { method: 'GET', path: '/hello', handler: 'helloHandler' },
      { method: 'GET', path: '/users/:id', handler: 'userHandler' },
      { method: 'POST', path: '/users/:id', handler: 'userHandler' },
    ]);
  });

  it('recurses into nested routers with the mount prefix', () => {
    const stack = [
      {
        name: 'router',
        path: '/api',
        handle: {
          stack: [layer({ path: '/v1', methods: { get: true }, handler: 'v1Handler' })],
        },
      },
    ];
    const routes = extractRoutes({ stack });
    expect(routes).toEqual([{ method: 'GET', path: '/api/v1', handler: 'v1Handler' }]);
  });

  it('deduplicates identical method+path entries', () => {
    const stack = [
      layer({ path: '/x', methods: { get: true }, handler: 'a' }),
      layer({ path: '/x', methods: { get: true }, handler: 'b' }),
    ];
    const routes = extractRoutes({ stack });
    expect(routes).toHaveLength(1);
  });

  it('is resilient to missing router structures', () => {
    expect(extractRoutes(undefined)).toEqual([]);
    expect(extractRoutes({ stack: 'nope' })).toEqual([]);
  });

  it('falls back to anonymous for empty handler names', () => {
    const stack = [
      {
        name: 'bound dispatch',
        route: {
          path: '/x',
          methods: { get: true },
          stack: [{ handle: { name: '' } }],
        },
      },
    ];
    const routes = extractRoutes({ stack });
    expect(routes).toEqual([{ method: 'GET', path: '/x', handler: 'anonymous' }]);
  });
});

describe('RoutesProvider', () => {
  it('returns an error envelope when no router was captured', () => {
    const provider = new RoutesProvider();
    const result = provider.get(makeCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('router-unavailable');
  });

  it('returns routes from the captured router', () => {
    const provider = new RoutesProvider();
    const ctx = makeCtx({
      'express-router': {
        stack: [layer({ path: '/hello', methods: { get: true }, handler: 'helloHandler' })],
      },
    });
    const result = provider.get(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.routes).toEqual([
      { method: 'GET', path: '/hello', handler: 'helloHandler' },
    ]);
  });
});
