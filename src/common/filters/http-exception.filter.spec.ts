import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};
type CapturedBody = {
  statusCode: number;
  error: string;
  message: string;
  timestamp: string;
  path: string;
  requestId: string;
};

function makeHost(
  request: Partial<{ url: string; path: string; requestId: string }> = {},
): {
  host: ArgumentsHost;
  response: MockResponse;
  getBody: () => CapturedBody;
} {
  const response: MockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const req = {
    url: request.url ?? '/test',
    path: request.path ?? '/test',
    requestId: request.requestId,
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => req,
      getNext: () => () => undefined,
    }),
    getArgByIndex: () => undefined,
    getArgs: () => [] as unknown[],
    getType: () => 'http' as const,
  } as unknown as ArgumentsHost;
  return {
    host,
    response,
    getBody: () => (response.json.mock.calls as Array<[CapturedBody]>)[0][0],
  };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('maps an HttpException with object body to the standard shape', () => {
    const { host, response, getBody } = makeHost({
      url: '/x',
      requestId: 'req-1',
    });
    filter.catch(new BadRequestException('bad input'), host);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = getBody();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBe('bad input');
    expect(body.path).toBe('/x');
    expect(body.requestId).toBe('req-1');
    expect(typeof body.timestamp).toBe('string');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it('uses the string response when HttpException.getResponse() returns a string', () => {
    const { host, getBody } = makeHost();
    class StringEx extends HttpException {
      constructor() {
        super('plain string body', 418);
      }
    }
    filter.catch(new StringEx(), host);
    expect(getBody().message).toBe('plain string body');
  });

  it('joins array message into a comma-separated string', () => {
    const { host, getBody } = makeHost();
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['first error', 'second error'],
        error: 'Bad Request',
      }),
      host,
    );
    expect(getBody().message).toBe('first error, second error');
  });

  it('falls back to "unknown" requestId when none is present on the request', () => {
    const { host, getBody } = makeHost({ requestId: undefined });
    filter.catch(new NotFoundException('nope'), host);
    expect(getBody().requestId).toBe('unknown');
  });

  it('uses requestId from the request when set by the middleware', () => {
    const { host, getBody } = makeHost({ requestId: 'abc-123' });
    filter.catch(new ForbiddenException('no'), host);
    expect(getBody().requestId).toBe('abc-123');
  });

  it('maps a non-HTTP Error to a 500 Internal-shape body', () => {
    const { host, response, getBody } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(getBody().statusCode).toBe(500);
    expect(getBody().error).toBe('Error');
    expect(getBody().message).toBe('boom');
  });

  it('maps an unknown throwable (non-Error) to a safe 500 body', () => {
    const { host, response, getBody } = makeHost();
    filter.catch({ weird: 'thing' }, host);
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(getBody().statusCode).toBe(500);
    expect(getBody().error).toBe('Error');
    expect(getBody().message).toBe('Internal server error');
  });

  it('uses request.path when request.url is absent', () => {
    const response: MockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ path: '/from-path', requestId: 'r' }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(new NotFoundException(), host);
    const body = (response.json.mock.calls as Array<[CapturedBody]>)[0][0];
    expect(body.path).toBe('/from-path');
  });

  describe('httpNameForStatus', () => {
    const cases: Array<[HttpException, string, number]> = [
      [new BadRequestException(), 'Bad Request', 400],
      [new UnauthorizedException(), 'Unauthorized', 401],
      [new ForbiddenException(), 'Forbidden', 403],
      [new NotFoundException(), 'Not Found', 404],
      [new ConflictException(), 'Conflict', 409],
      [new UnprocessableEntityException(), 'Unprocessable Entity', 422],
    ];

    it.each(cases)('labels %s as "%s" with status %d', (exc, label, status) => {
      const { host, response, getBody } = makeHost();
      filter.catch(exc, host);
      expect(response.status).toHaveBeenCalledWith(status);
      expect(getBody().error).toBe(label);
    });

    it('falls back to "Error" for non-mapped statuses', () => {
      class TeapotEx extends HttpException {
        constructor() {
          super('short and stout', 418);
        }
      }
      const { host, getBody } = makeHost();
      filter.catch(new TeapotEx(), host);
      expect(getBody().error).toBe('Error');
    });
  });
});
