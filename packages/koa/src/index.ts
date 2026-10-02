import type { Middleware } from 'koa';
import {
  createNodeUI,
  runInRequestContext,
  type NodeUIOptions,
  type NodeUIServer,
} from '@singhak/nodeui-core';

export interface NodeUIKoa {
  /** Koa middleware that mounts the console; register it first: `app.use(middleware)`. */
  middleware: Middleware;
  /** Handle to the underlying server (mark, shutdown, config, recordError, ...). */
  server: NodeUIServer;
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource: NodeUIServer['addLogSource'];
}

/**
 * Creates the NodeUI Koa middleware plus its server handle. Register it before
 * your routers so every request is recorded; errors thrown downstream are
 * recorded in the Errors panel and re-thrown untouched. `@koa/router` route
 * patterns (`/users/:id`) are picked up automatically.
 *
 * @example
 * const { middleware, server } = nodeui();
 * app.use(middleware);
 * app.listen(3000, '127.0.0.1', () => server.mark('listening'));
 */
export function nodeui(options?: NodeUIOptions): NodeUIKoa {
  const server = createNodeUI(options);
  const prefix = server.config.path;
  const recorder = server.middleware();

  const middleware: Middleware = async (ctx, next) => {
    if (!server.active) {
      await next();
      return;
    }
    if (ctx.path === prefix || ctx.path.startsWith(`${prefix}/`)) {
      ctx.respond = false; // core writes the response itself
      await server.handle(ctx.req, ctx.res);
      return;
    }
    // Core's middleware records the request (finish listener) and binds its id.
    recorder(ctx.req, ctx.res, () => undefined);
    const routeOf = (): string | undefined => {
      const matched = (ctx as unknown as { _matchedRoute?: unknown })._matchedRoute;
      return typeof matched === 'string' ? matched : undefined;
    };
    try {
      await runInRequestContext(ctx.req, next);
    } catch (error) {
      server.recordError(error, { route: routeOf() });
      throw error;
    } finally {
      const route = routeOf();
      if (route) (ctx.req as { nodeuiRoute?: string }).nodeuiRoute = route;
    }
  };

  return { middleware, server, addLogSource: server.addLogSource };
}

export * from '@singhak/nodeui-core';
