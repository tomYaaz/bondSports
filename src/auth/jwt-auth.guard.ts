import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (JwtAuthGuard.isSwaggerPublicPath(req.path)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  /** Swagger UI + OpenAPI JSON must work without JWT (see plan/08-api-documentation.md). */
  private static isSwaggerPublicPath(path: string): boolean {
    return (
      path === '/api/docs' ||
      path === '/api/docs-json' ||
      path.startsWith('/api/docs/') ||
      path.startsWith('/api/docs-')
    );
  }
}
