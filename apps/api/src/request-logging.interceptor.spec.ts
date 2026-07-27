import { BadRequestException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

function httpContext(request: any, response: any) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ExecutionContext;
}

describe('RequestLoggingInterceptor', () => {
  it('logs request identity and timing without headers, query secrets, or bodies', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation();
    const response = { statusCode: 201, setHeader: jest.fn() };
    const request = {
      method: 'POST',
      originalUrl: '/api/documents?token=query-secret',
      headers: { authorization: 'Bearer header-secret', cookie: 'session=cookie-secret', 'x-request-id': 'req-123' },
      body: { password: 'body-secret' },
      actor: { userId: 42n, tenantId: 7n },
    };

    await lastValueFrom(new RequestLoggingInterceptor().intercept(
      httpContext(request, response),
      { handle: () => of({ ok: true }) } as CallHandler,
    ));

    expect(response.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-123');
    const serialized = String(log.mock.calls[0][0]);
    expect(JSON.parse(serialized)).toMatchObject({
      event: 'http_request',
      requestId: 'req-123',
      method: 'POST',
      route: '/api/documents',
      statusCode: 201,
      userId: '42',
      tenantId: '7',
    });
    expect(serialized).not.toMatch(/query-secret|header-secret|cookie-secret|body-secret|authorization|password/i);
    log.mockRestore();
  });

  it('records safe HTTP errors without exposing unexpected error details', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation();
    const response = { statusCode: 200, setHeader: jest.fn() };
    const request = { method: 'POST', originalUrl: '/api/documents', headers: {} };

    await expect(lastValueFrom(new RequestLoggingInterceptor().intercept(
      httpContext(request, response),
      { handle: () => throwError(() => new BadRequestException('Document is invalid')) } as CallHandler,
    ))).rejects.toThrow('Document is invalid');

    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({
      level: 'error',
      statusCode: 400,
      error: { name: 'BadRequestException', message: 'Document is invalid' },
    });
    error.mockRestore();
  });
});
