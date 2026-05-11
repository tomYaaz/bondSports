## 6. Error handling

Create a global exception filter that catches HttpException (and raw Error) and always returns a consistent shape:

typescript// Response shape for every error (see plan/17-resilience-operability.md):
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "Insufficient funds",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/accounts/abc-123/withdraw",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}

Register it globally in main.ts:

typescriptapp.useGlobalFilters(new HttpExceptionFilter());
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

whitelist: true strips unknown DTO fields. forbidNonWhitelisted: true throws a 400 if the client sends unknown properties. Both are table-stakes for a financial API.

### Error-to-status mapping (make it explicit)
- **400**: DTO validation errors, invalid statement range (`from > to`), missing `Idempotency-Key` on deposit/withdraw
- **401**: missing or invalid JWT on protected routes
- **403**: blocked account; or authenticated user lacks **admin** role on `PATCH .../block|unblock`
- **404**: account not found (or not owned — enumeration-safe policy)
- **409**: idempotency key reused with a different request body (see `plan/04-critical-endpoints.md`)
- **422**: insufficient funds, daily withdrawal limit exceeded

