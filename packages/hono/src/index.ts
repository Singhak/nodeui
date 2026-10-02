import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import {
  createNodeUI,
  runInRequestContext,
  type NodeUIOptions,
  type NodeUIServer,
  type RouteEntry,
} from '@singhak/nodeui-core';
import type { Hono, MiddlewareHandler } from 'hono';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface NodeUIHono {
  /** Hono middleware; register it first: `app.use('*', ui.middleware)`. */
  middleware: MiddlewareHandler;
  /** Handle to the underlying server (mark, shutdown, config, recordError, ...). */
  server: NodeUIServer;
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource: NodeUIServer['addLogSource'];
  /** Feeds the Routes panel from a Hono app's route table. */
  setApp(app: Hono): void;
}

interface NodeBindings {
  incoming?: IncomingMessage;
  outgoing?: ServerResponse;
}

/**
 * Creates the NodeUI middleware for Hono on the Node.js runtime
 * (`@hono/node-server`, which exposes the underlying `IncomingMessage` and
 * `ServerResponse`). Other runtimes (Workers, Deno, Bun) are not supported:
 * the middleware is then a pass-through.
 *
 * @example
 * const ui = nodeui();
 * app.use('*', ui.middleware);
 * ui.setApp(app);
 * serve({ fetch: app.fetch, port: 3000, hostname: '127.0.0.1' });
 */
export function nodeui(options?: NodeUIOptions): NodeUIHono {
  const server = createNodeUI(options);
  const prefix = server.config.path;
  const recorder = server.middleware();

  const middleware: MiddlewareHandler = async (c, next) => {
    const env = c.env as NodeBindings | undefined;
    const incoming = env?.incoming;
    const outgoing = env?.outgoing;
    if (!server.active || !incoming || !outgoing) {
      await next();
      return;
    }
    const path = c.req.path;
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      await server.handle(incoming, outgoing);
      return RESPONSE_ALREADY_SENT;
    }
    recorder(incoming, outgoing, () => undefined);
    try {
      await runInRequestContext(incoming, next);
    } finally {
      // Hono routes errors to onError and exposes them here instead of throwing.
      if (c.error) server.recordError(c.error, { route: c.req.routePath });
      const route = c.req.routePath;
      if (route && route !== '*' && route !== '/*') {
        (incoming as { nodeuiRoute?: string }).nodeuiRoute = route;
      }
    }
  };

  const setApp = (app: Hono): void => {
    server.setRoutes((): RouteEntry[] =>
      app.routes
        .filter((r) => r.handler !== middleware && r.path !== '*' && r.path !== '/*')
        .map((r) => ({
          method: r.method.toUpperCase(),
          path: r.path,
          handler: r.handler.name || 'anonymous',
        }))
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    );
  };

  return { middleware, server, addLogSource: server.addLogSource, setApp };
}

export * from '@singhak/nodeui-core';
