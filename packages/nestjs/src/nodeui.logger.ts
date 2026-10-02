import { ConsoleLogger, Inject, Injectable } from '@nestjs/common';
import type { NodeUIServer } from '@singhak/nodeui-core';
import { NODEUI_SERVER } from './tokens';

type Level = 'debug' | 'info' | 'warn' | 'error';

function format(message: unknown, optionalParams: unknown[]): string {
  const parts = [
    message,
    ...optionalParams.filter((p) => typeof p === 'string' || p instanceof Error),
  ];
  return parts
    .map((p) =>
      typeof p === 'string' ? p : p instanceof Error ? (p.stack ?? p.message) : JSON.stringify(p),
    )
    .join(' ');
}

/**
 * Nest's default logger writes straight to `process.stdout`, bypassing
 * `console.*`, so the Logs panel would stay empty. Use this logger to mirror
 * every Nest log line into the panel while keeping the normal console output.
 *
 * @example
 * const app = await NestFactory.create(AppModule, { bufferLogs: true });
 * app.useLogger(app.get(NodeUILogger));
 */
@Injectable()
export class NodeUILogger extends ConsoleLogger {
  constructor(@Inject(NODEUI_SERVER) private readonly server: NodeUIServer) {
    super();
  }

  private tee(level: Level, message: unknown, params: unknown[]): void {
    this.server.addLogSource({ level, message: format(message, params) });
  }

  override log(message: unknown, ...optionalParams: unknown[]): void {
    this.tee('info', message, optionalParams);
    super.log(message, ...optionalParams);
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    this.tee('warn', message, optionalParams);
    super.warn(message, ...optionalParams);
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    this.tee('error', message, optionalParams);
    super.error(message, ...optionalParams);
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    this.tee('debug', message, optionalParams);
    super.debug(message, ...optionalParams);
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.tee('debug', message, optionalParams);
    super.verbose(message, ...optionalParams);
  }
}
