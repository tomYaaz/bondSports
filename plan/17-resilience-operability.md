## 17. Resilience + operability (small, explicit plan)

This is not a production system, but we still document a few “real service” behaviors so reviewers see we’ve thought about failure modes.

### Transaction retries / deadlocks
- Postgres can throw transient errors under contention (e.g., deadlocks).
- Plan: **bounded retry** around the top-level `deposit/withdraw` transaction for known retryable SQLSTATE codes:
  - `40P01` (deadlock_detected)
  - `40001` (serialization_failure) if ever used
- Retry policy: max 2 retries, exponential backoff with jitter (e.g., 25–100ms).
- If a retry happens, it must respect **idempotency** (so we don’t double-credit/debit).

### Health endpoint
- Add `GET /health` marked `@Public()`.
- Health checks:
  - liveness: process up
  - readiness: DB connectivity check (simple `SELECT 1`)

### Correlation id (requestId)
- Accept `X-Request-Id` header; if missing, generate a UUID per request.
- Include `requestId` in logs and in error responses — canonical JSON shape is in `plan/06-error-handling.md`.

### Timeouts
- Use a reasonable DB query timeout for statement queries (and a max `limit` already enforced).
- Keep HTTP timeouts default; avoid long-running requests by bounding statement ranges/limits.

