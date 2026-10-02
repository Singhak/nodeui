import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import {
  createNodeUI,
  runInRequestContext,
  type NodeUIOptions,
  type NodeUIServer,
} from '@singhak/nodeui-core';

export interface NodeUIHttp {
  /**
   * Serves the console on `httpServer` and records every other request, then
   * lets your handler run inside the request's async context. Call it once,
   * before or after `listen`. Returns a function that detaches NodeUI again.
   */
  attach(httpServer: HttpServer): () => void;
  /** Handle to the underlying server (mark, shutdown, config, recordError, ...). */
  server: NodeUIServer;
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource: NodeUIServer['addLogSource'];
}

/**
 * NodeUI for anything built on `node:http`: plain servers, Restify, micro, and
 * Next.js custom servers (`createServer((req, res) => handle(req, res))`).
 * It wraps the server's `request` event, so it works regardless of framework.
 * Route patterns are not known at this level; set `req.nodeuiRoute` yourself
 * if you want grouped routes. Next.js route handlers and the Edge runtime do
 * not expose a Node request/response and are not supported.
 *
 * @example
 * const ui = nodeui();
 * const httpServer = createServer((req, res) => handle(req, res));
 * ui.attach(httpServer);
 * httpServer.listen(3000, '127.0.0.1', () => ui.server.mark('listening'));
 */
export function nodeui(options?: NodeUIOptions): NodeUIHttp {
  const server = createNodeUI(options);
  const prefix = server.config.path;
  const recorder = server.middleware();

  const isUnderPrefix = (url: string | undefined): boolean => {
    let path = url ?? '/';
    try {
      path = new URL(path, 'http://localhost').pathname;
    } catch {
      // keep the raw value
    }
    return path === prefix || path.startsWith(`${prefix}/`);
  };

  const attach = (httpServer: HttpServer): (() => void) => {
    if (!server.active) return () => undefined;
    const originalEmit = httpServer.emit.bind(httpServer) as (
      event: string | symbol,
      ...args: unknown[]
    ) => boolean;
    httpServer.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
      if (event === 'request') {
        const [req, res] = args as [IncomingMessage, ServerResponse];
        if (isUnderPrefix(req.url)) {
          void server.handle(req, res);
          return true; // the console owns this request; the app never sees it
        }
        recorder(req, res, () => undefined);
        return runInRequestContext(req, () => originalEmit(event, ...args));
      }
      return originalEmit(event, ...args);
    }) as typeof httpServer.emit;
    return () => {
      httpServer.emit = originalEmit as typeof httpServer.emit;
    };
  };

  return { attach, server, addLogSource: server.addLogSource };
}

export * from '@singhak/nodeui-core';
