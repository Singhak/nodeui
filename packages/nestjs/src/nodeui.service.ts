import { Inject, Injectable } from '@nestjs/common';
import type { NodeUIServer } from '@nodeui/core';
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

  shutdown(): void {
    this.server.shutdown();
  }

  addLogSource(entry: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }): void {
    this.server.addLogSource(entry);
  }
}
