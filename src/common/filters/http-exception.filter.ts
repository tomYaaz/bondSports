/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Nest HTTP context typing */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const requestId = request.requestId ?? 'unknown';

    let message: string | string[];
    let errorLabel: string;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      errorLabel = HttpExceptionFilter.httpNameForStatus(status);
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object' && 'message' in body) {
        const m = (body as { message: string | string[] }).message;
        message = m;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      errorLabel = 'Error';
    } else {
      message = 'Internal server error';
      errorLabel = 'Error';
    }

    const messageField = Array.isArray(message) ? message.join(', ') : message;

    response.status(status).json({
      statusCode: status,
      error: errorLabel,
      message: messageField,
      timestamp: new Date().toISOString(),
      path: request.url ?? request.path,
      requestId,
    });
  }

  private static httpNameForStatus(status: number): string {
    switch (status) {
      case 400:
        return 'Bad Request';
      case 401:
        return 'Unauthorized';
      case 403:
        return 'Forbidden';
      case 404:
        return 'Not Found';
      case 409:
        return 'Conflict';
      case 422:
        return 'Unprocessable Entity';
      default:
        return 'Error';
    }
  }
}
