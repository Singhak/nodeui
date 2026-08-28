import { DynamicModule, Inject, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { createNodeUI, type NodeUIOptions, type NodeUIServer } from '@nodeui/core';
import { NodeUIService } from './nodeui.service';
import { NODEUI_SERVER } from './tokens';

/**
 * NestJS adapter for the NodeUI developer console. Mounts the core middleware
 * for every route; the console and its API live under `NODEUI_PATH` (default
 * `/nodeui`) and app requests are recorded in the request log.
 *
 * @example
 * @Module({ imports: [NodeUIModule.register()] })
 * export class AppModule {}
 */
@Module({})
export class NodeUIModule implements NestModule {
  static register(options?: NodeUIOptions): DynamicModule {
    const server = createNodeUI(options);
    return {
      module: NodeUIModule,
      providers: [{ provide: NODEUI_SERVER, useValue: server }, NodeUIService],
      exports: [NodeUIService, NODEUI_SERVER],
    };
  }

  constructor(@Inject(NODEUI_SERVER) private readonly server: NodeUIServer) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(this.server.middleware()).forRoutes('*');
  }
}
