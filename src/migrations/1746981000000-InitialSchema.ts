import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1746981000000 implements MigrationInterface {
  name = 'InitialSchema1746981000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "accountId" uuid NOT NULL DEFAULT gen_random_uuid(),
        "personId" uuid NOT NULL,
        "balance" numeric(21,6) NOT NULL DEFAULT 0,
        "dailyWithdrawalLimit" numeric(21,6) NOT NULL,
        "activeFlag" boolean NOT NULL DEFAULT true,
        "accountType" integer NOT NULL,
        "createDate" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_accounts" PRIMARY KEY ("accountId"),
        CONSTRAINT "CHK_accounts_balance_nonneg" CHECK ("balance" >= 0),
        CONSTRAINT "CHK_accounts_daily_limit_nonneg" CHECK ("dailyWithdrawalLimit" >= 0),
        CONSTRAINT "CHK_accounts_type" CHECK ("accountType" IN (1, 2))
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "transactions_type_enum" AS ENUM ('DEPOSIT', 'WITHDRAWAL')
    `);

    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "transactionId" uuid NOT NULL DEFAULT gen_random_uuid(),
        "accountId" uuid NOT NULL,
        "value" numeric(21,6) NOT NULL,
        "type" "transactions_type_enum" NOT NULL,
        "idempotencyKey" character varying(128),
        "transactionDate" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transactions" PRIMARY KEY ("transactionId"),
        CONSTRAINT "FK_transactions_account" FOREIGN KEY ("accountId") REFERENCES "accounts"("accountId") ON DELETE RESTRICT,
        CONSTRAINT "CHK_transactions_value_pos" CHECK ("value" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_transactions_statement"
      ON "transactions" ("accountId", "transactionDate", "transactionId")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_transactions_daily_withdraw_sum"
      ON "transactions" ("accountId", "type", "transactionDate")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_transactions_idempotency"
      ON "transactions" ("accountId", "type", "idempotencyKey")
      WHERE "idempotencyKey" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_transactions_idempotency"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_transactions_daily_withdraw_sum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_transactions_statement"`);
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(`DROP TYPE "transactions_type_enum"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
  }
}
