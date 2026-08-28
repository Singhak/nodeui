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
  return { middleware: server.middleware(), server, addLogSource: server.addLogSource };
}

export * from '@singhak/nodeui-core';
