import { Inject, Injectable } from '@nestjs/common';
import type { NodeUIServer } from '@singhak/nodeui-core';
import { NODEUI_SERVER } from './tokens';

/** Injectable handle to the NodeUI server: record startup marks, read config. */
@Injectable()
export class NodeUIService {
  constructor(@Inject(NODEUI_SERVER) private readonly server: NodeUIServer) {}

  mark(name: string): void {
    this.server.mark(name);
  }

  get config() {
    return this.server.config;
  }

  /** Records an error in the Errors panel (also done automatically for uncaught request errors). */
  recordError(error: unknown, context?: Parameters<NodeUIServer['recordError']>[1]): void {
    this.server.recordError(error, context);
  }

  /** Records a database query (pg and mysql2 are captured automatically). */
  recordQuery(query: Parameters<NodeUIServer['recordQuery']>[0]): void {
    this.server.recordQuery(query);
  }

  shutdown(): void {
    this.server.shutdown();
  }

  addLogSource(entry: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }): void {
    this.server.addLogSource(entry);
  }
}
