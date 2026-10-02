import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { NodeUIServer } from '@singhak/nodeui-core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { NODEUI_SERVER } from './tokens';

/**
 * Records errors thrown by route handlers in the Errors panel and rethrows them
 * untouched. Client errors (`HttpException` < 500) are expected and skipped.
 * Errors raised earlier, in guards or pipes, bypass interceptors.
 */
@Injectable()
export class NodeUIErrorInterceptor implements NestInterceptor {
  constructor(@Inject(NODEUI_SERVER) private readonly server: NodeUIServer) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : undefined;
        if (status === undefined || status >= 500) {
          this.server.recordError(error, status === undefined ? {} : { status });
        }
        return throwError(() => error);
      }),
    );
  }
}
