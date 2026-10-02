import {
  DynamicModule,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleDestroy,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { createNodeUI, type NodeUIOptions, type NodeUIServer } from '@singhak/nodeui-core';
import { NodeUIErrorInterceptor } from './nodeui.interceptor';
import { NodeUILogger } from './nodeui.logger';
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
export class NodeUIModule implements NestModule, OnModuleDestroy {
  static register(options?: NodeUIOptions): DynamicModule {
    const server = createNodeUI(options);
    return {
      module: NodeUIModule,
      providers: [
        { provide: NODEUI_SERVER, useValue: server },
        { provide: APP_INTERCEPTOR, useClass: NodeUIErrorInterceptor },
        NodeUIService,
        NodeUILogger,
      ],
      exports: [NodeUIService, NodeUILogger, NODEUI_SERVER],
    };
  }

  constructor(@Inject(NODEUI_SERVER) private readonly server: NodeUIServer) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(this.server.middleware()).forRoutes('*');
  }

  /** Stops samplers and restores `console.*` when the Nest app closes. */
  onModuleDestroy(): void {
    this.server.shutdown();
  }
}
