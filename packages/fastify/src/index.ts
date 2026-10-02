import type { FastifyInstance, FastifyPluginCallback, RouteOptions } from 'fastify';
import {
  createNodeUI,
  type NodeUIOptions,
  type NodeUIServer,
  type RouteEntry,
} from '@singhak/nodeui-core';

export interface NodeUIFastifyPlugin extends FastifyPluginCallback {
  /** Handle to the underlying server (mark, shutdown, config). */
  server: NodeUIServer;
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource: NodeUIServer['addLogSource'];
}

function pathnameOf(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return url ?? '/';
  }
}

/**
 * Creates the NodeUI Fastify plugin. Register it before your routes so the
 * routes panel and request log see them.
 *
 * @example
 * const ui = nodeui();
 * await app.register(ui);
 * await app.listen({ port: 3000, host: '127.0.0.1' });
 * ui.server.mark('listening');
 */
export function nodeui(options?: NodeUIOptions): NodeUIFastifyPlugin {
  const server = createNodeUI(options);
  const prefix = server.config.path;
  const isUnderPrefix = (p: string): boolean => p === prefix || p.startsWith(`${prefix}/`);
  const recorder = server.middleware();
  const routes = new Map<string, RouteEntry>();

  const plugin = ((app: FastifyInstance, _opts: unknown, done: (err?: Error) => void) => {
    if (!server.active) {
      done();
      return;
    }

    server.setRoutes(() =>
      [...routes.values()].sort(
        (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
      ),
    );

    app.addHook('onRoute', (route: RouteOptions) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      const handler = (route.handler as { name?: string } | undefined)?.name || 'anonymous';
      for (const m of methods) {
        const method = String(m).toUpperCase();
        if (isUnderPrefix(route.url)) continue;
        routes.set(`${method} ${route.url}`, { method, path: route.url, handler });
      }
    });

    app.addHook('onRequest', async (req, reply) => {
      if (isUnderPrefix(pathnameOf(req.raw.url))) {
        reply.hijack();
        await server.handle(req.raw, reply.raw);
        return;
      }
      // Expose the matched route pattern to core's request recorder.
      const pattern =
        (req as { routeOptions?: { url?: string } }).routeOptions?.url ??
        (req as { routerPath?: string }).routerPath;
      if (pattern) (req.raw as { nodeuiRoute?: string }).nodeuiRoute = pattern;
      // Core's middleware records the request (finish listener) then calls next.
      recorder(req.raw, reply.raw, () => undefined);
    });

    app.addHook('onClose', (_instance, next) => {
      server.shutdown();
      next();
    });
    done();
  }) as NodeUIFastifyPlugin;

  // Same effect as fastify-plugin: expose hooks to the parent scope.
  const marks = plugin as unknown as Record<symbol, unknown>;
  marks[Symbol.for('skip-override')] = true;
  marks[Symbol.for('fastify.display-name')] = 'nodeui-fastify';
  plugin.server = server;
  plugin.addLogSource = server.addLogSource;
  return plugin;
}

export * from '@singhak/nodeui-core';
