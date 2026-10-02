import type { Plugin, Request, Server } from '@hapi/hapi';
import {
  createNodeUI,
  runInRequestContext,
  type NodeUIOptions,
  type NodeUIServer,
  type RouteEntry,
} from '@singhak/nodeui-core';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface NodeUIHapi {
  /** Hapi plugin; register it before your routes: `await server.register(ui.plugin)`. */
  plugin: Plugin<undefined>;
  /** Handle to the underlying server (mark, shutdown, config, recordError, ...). */
  server: NodeUIServer;
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource: NodeUIServer['addLogSource'];
}

/**
 * Creates the NodeUI Hapi plugin plus its server handle. Requests are recorded
 * with their route pattern, 5xx errors reach the Errors panel, and the route
 * table feeds the Routes panel.
 *
 * @example
 * const ui = nodeui();
 * await server.register(ui.plugin);
 * await server.start();
 * ui.server.mark('listening');
 */
export function nodeui(options?: NodeUIOptions): NodeUIHapi {
  const core = createNodeUI(options);
  const prefix = core.config.path;
  const isUnderPrefix = (url: string | undefined): boolean => {
    let path = url ?? '/';
    try {
      path = new URL(path, 'http://localhost').pathname;
    } catch {
      // keep the raw value
    }
    return path === prefix || path.startsWith(`${prefix}/`);
  };
  const recorder = core.middleware();

  const plugin: Plugin<undefined> = {
    name: 'nodeui',
    register(hapi: Server) {
      if (!core.active) return;

      core.setRoutes((): RouteEntry[] =>
        hapi
          .table()
          .filter((r) => !isUnderPrefix(r.path))
          .map((r) => ({
            method: r.method === '*' ? 'ALL' : r.method.toUpperCase(),
            path: r.path,
            handler: 'handler',
          }))
          .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
      );

      // Record every app request and run the rest of Hapi's lifecycle inside its
      // async context, so outgoing calls and logs are attributed to it.
      const listener = hapi.listener;
      const originalEmit = listener.emit.bind(listener) as (
        event: string | symbol,
        ...args: unknown[]
      ) => boolean;
      listener.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
        if (event === 'request') {
          const [req, res] = args as [IncomingMessage, ServerResponse];
          if (!isUnderPrefix(req.url)) {
            recorder(req, res, () => undefined);
            return runInRequestContext(req, () => originalEmit(event, ...args));
          }
        }
        return originalEmit(event, ...args);
      }) as typeof listener.emit;
      hapi.events.on('stop', () => {
        listener.emit = originalEmit as typeof listener.emit;
      });

      hapi.ext('onRequest', async (request, h) => {
        const { req, res } = request.raw;
        if (!isUnderPrefix(req.url)) return h.continue;
        await core.handle(req, res);
        return h.abandon;
      });

      hapi.ext('onPreResponse', (request: Request, h) => {
        const pattern = request.route?.path;
        if (pattern) (request.raw.req as { nodeuiRoute?: string }).nodeuiRoute = pattern;
        return h.continue;
      });

      // 'error' channel: handler exceptions turned into 500s.
      hapi.events.on({ name: 'request', channels: 'error' }, (request, event) => {
        core.recordError(event.error, { route: request.route?.path });
      });
    },
  };

  return { plugin, server: core, addLogSource: core.addLogSource };
}

export * from '@singhak/nodeui-core';
