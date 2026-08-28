import type { NodeUIProvider, ProviderContext, RouteEntry, RoutesData } from '../types';

interface RouterLayer {
  name?: string;
  path?: string;
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle?: { name?: string } }>;
  };
  handle?: { stack?: RouterLayer[] };
}

function joinPath(prefix: string, sub: string): string {
  if (!sub || sub === '/') return prefix || '/';
  return `${prefix.replace(/\/+$/, '')}/${sub.replace(/^\/+/, '')}`;
}

/**
 * Recursively walks an Express-style router stack, extracting concrete
 * method + path + handler entries. Middleware-only layers are skipped.
 *
 * NOTE: This intentionally relies on Express router internals
 * (`router.stack`, `layer.route`, `layer.handle.stack`), which are stable in
 * Express 4 and 5 but not part of the public API. If a future Express
 * release changes the shape, this is the only place that needs updating —
 * the walk degrades to an empty list rather than throwing.
 */
export function extractRoutes(router: unknown): RouteEntry[] {
  const out: RouteEntry[] = [];
  const seen = new Set<string>();
  let stack: unknown;
  try {
    stack = (router as { stack?: unknown } | undefined)?.stack;
  } catch {
    return out;
  }
  if (!Array.isArray(stack)) return out;

  const walk = (layers: RouterLayer[], prefix: string): void => {
    for (const layer of layers) {
      if (!layer || typeof layer !== 'object') continue;
      if (layer.route && typeof layer.route.path === 'string') {
        const path = joinPath(prefix, layer.route.path);
        const methods = Object.entries(layer.route.methods ?? {})
          .filter(([, enabled]) => enabled)
          .map(([method]) => method.toUpperCase());
        const handler = layer.route.stack?.[0]?.handle?.name || 'anonymous';
        if (methods.length === 0) continue;
        for (const method of methods) {
          const key = `${method} ${path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ method, path, handler });
        }
        continue;
      }
      const nested = layer.handle?.stack;
      if (Array.isArray(nested)) {
        walk(nested, joinPath(prefix, layer.path ?? ''));
      }
    }
  };

  try {
    walk(stack as RouterLayer[], '');
  } catch {
    return [];
  }
  out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return out;
}

/**
 * Lists the HTTP routes of the host application by introspecting the Express
 * router captured from `req.app._router` (or `req.app.router` on Express 5)
 * on the first handled request. Results are cached per router reference so
 * repeated fetches do not re-walk the stack.
 */
export class RoutesProvider implements NodeUIProvider<RoutesData> {
  readonly id = 'routes' as const;

  private cache = new WeakMap<object, RouteEntry[]>();

  get(
    ctx: ProviderContext,
  ): { ok: true; data: RoutesData } | { ok: false; error: { code: string; message: string } } {
    const router = ctx.store['express-router'];
    if (!router) {
      return {
        ok: false,
        error: {
          code: 'router-unavailable',
          message: 'No Express router captured yet. Send at least one request through the app.',
        },
      };
    }
    if (typeof router !== 'object' && typeof router !== 'function') {
      return {
        ok: false,
        error: {
          code: 'router-invalid',
          message: 'Captured router has an unexpected shape; route listing is unavailable.',
        },
      };
    }
    let routes = this.cache.get(router as object);
    if (!routes) {
      routes = extractRoutes(router);
      this.cache.set(router as object, routes);
    }
    return { ok: true, data: { routes } };
  }
}
