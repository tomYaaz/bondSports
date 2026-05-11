## Database config + environment (required delta)

### `synchronize: false` (non-negotiable)

The database config must explicitly set `synchronize: false`.

typescript
// src/config/database.config.ts
export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false,  // NEVER true — mutates schema on startup
  logging: process.env.NODE_ENV === 'development',
});

### Environment configuration (`@nestjs/config`)

Install and wire up `@nestjs/config`.

typescript
// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: databaseConfig,
    }),
    AccountsModule,
    TransactionsModule,
  ],
})
export class AppModule {}

### `.env.example` at repo root

bash
# .env.example
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=accounts_db
NODE_ENV=development
PORT=3000
JWT_SECRET=change_me_in_production
# Test admin JWT: include claim roles: ["admin"] for PATCH .../block|unblock (see README + plan/15-security-auth-ownership.md)

