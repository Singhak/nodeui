import type { ErrorRequestHandler } from 'express';
import {
  createNodeUI,
  type NodeUIMiddleware,
  type NodeUIOptions,
  type NodeUIServer,
} from '@singhak/nodeui-core';

export interface NodeUIExpress {
  /** Express middleware that mounts the console; call `app.use(middleware)`. */
  middleware: NodeUIMiddleware;
  /** Handle to the underlying server (mark, shutdown, config). */
  server: NodeUIServer;
  /** Pushes an external log entry into the log viewer (logger adapter). */
  addLogSource: NodeUIServer['addLogSource'];
  /**
   * Error-handling middleware that records the error in the Errors panel and
   * passes it on. Register it after your routes: `app.use(errorHandler)`.
   */
  errorHandler: ErrorRequestHandler;
}

/**
 * Creates the NodeUI Express middleware plus its server handle.
 *
 * @example
 * const { middleware, server } = nodeui();
 * app.use(middleware);
 * app.listen(3000, "127.0.0.1", () => server.mark("listening"));
 */
export function nodeui(options?: NodeUIOptions): NodeUIExpress {
  const server = createNodeUI(options);
  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    const route = (req as { route?: { path?: unknown } }).route?.path;
    server.recordError(err, {
      route: typeof route === 'string' ? `${req.baseUrl}${route}` : undefined,
    });
    next(err);
  };
  return {
    middleware: server.middleware(),
    server,
    addLogSource: server.addLogSource,
    errorHandler,
  };
}

export * from '@singhak/nodeui-core';
