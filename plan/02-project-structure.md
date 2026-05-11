## 2. Project structure

src/
├── auth/
│   ├── auth.module.ts
│   ├── jwt.strategy.ts
│   ├── jwt-auth.guard.ts
│   ├── public.decorator.ts
│   ├── roles.decorator.ts
│   ├── roles.guard.ts
│   └── current-user.decorator.ts
├── accounts/
│   ├── accounts.controller.ts
│   ├── accounts.service.ts
│   ├── accounts.module.ts
│   ├── dto/
│   │   ├── create-account.dto.ts
│   │   └── (no extra DTOs for block/unblock — admin-only PATCH)
│   └── entities/
│       └── account.entity.ts
├── transactions/
│   ├── transactions.controller.ts
│   ├── transactions.service.ts
│   ├── transactions.module.ts
│   ├── dto/
│   │   ├── deposit.dto.ts
│   │   ├── withdrawal.dto.ts
│   │   └── statement-filter.dto.ts
│   └── entities/
│       └── transaction.entity.ts
├── common/
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   └── pipes/
│   │   └── (ValidationPipe is global)
│   └── transformers/
│       └── money.transformer.ts
├── config/
│   └── database.config.ts
├── app.module.ts
└── main.ts

Why this structure? Each domain (accounts, transactions) is a self-contained NestJS module. `auth/` holds JWT + ownership helpers and **`RolesGuard`** for admin-only routes (`block`/`unblock`). `common/` holds cross-cutting concerns. This mirrors the feature-module pattern NestJS recommends, and it scales.

