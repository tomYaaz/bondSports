## Checklist — what the complete submission must have (required delta)

Every item here was either missing or incorrect in the previous plan:

- [x] moneyTransformer applied to all three money columns, no Number() calls in services
- [x] synchronize: false in database config, synchronize: true nowhere in the codebase
- [x] data-source.ts standalone file for TypeORM CLI
- [x] migration:generate, migration:run, migration:revert scripts in package.json
- [x] .env.example at repo root with all required variables (including JWT_SECRET)
- [x] docker-compose.yml with healthcheck on db and condition: service_healthy on api
- [x] PATCH /accounts/:id/unblock endpoint alongside block; both **admin-only** (`@Roles('admin')` + `RolesGuard`, JWT `roles` claim)
- [x] Money precision: no `parseFloat`/`number` for money in domain logic (entity money as string + Decimal math)
- [x] Deposit flow is atomic (transaction + invariants), blocked by `activeFlag`
- [x] Statement: validates from < to, uses UTC timestamp ranges (index-friendly), includes pagination + stable ordering
- [x] Swagger: `.addBearerAuth()` configured so `/api/docs` can authorize requests
- [x] Global guard has `@Public()` escape hatch for `/api/docs` and `/health`
- [x] README includes a concrete snippet to generate a test JWT locally
- [x] jest.config.ts with separate unit and e2e projects
- [x] CI pipeline (e.g. GitHub Actions): install → ESLint → unit tests → e2e (Docker/Testcontainers as in `plan/07-testing-strategy.md`)
- [x] ESLint + Prettier baseline (extends Nest defaults; format on save optional) — keeps review noise low
- [x] --runInBand on e2e test command
- [x] Seed helper used in beforeEach for clean test state
- [x] JWT auth guard layer implemented + applied (protected routes by default)
- [x] Ownership checks enforced on every account-scoped operation (enumeration-safe: return 404 for not owned)
- [x] ASCII architecture diagram in README
- [x] At least six numbered design decisions in README (more is fine)
