/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Nest HTTP context typing */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;
    const requestId = req.requestId ?? 'unknown';

    const started = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context
            .switchToHttp()
            .getResponse<{ statusCode?: number }>();

          const status = res.statusCode ?? 0;
          this.logger.log(
            `${method} ${url} ${status} ${Date.now() - started}ms requestId=${requestId}`,
          );
        },
        error: (err: unknown) => {
          const status =
            err && typeof err === 'object' && 'status' in err
              ? Number((err as { status?: number }).status)
              : 0;
          this.logger.warn(
            `${method} ${url} ${status || 'ERR'} ${Date.now() - started}ms requestId=${requestId}`,
          );
        },
      }),
    );
  }
}
