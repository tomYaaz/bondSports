/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access -- supertest JSON bodies are untyped */
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createConfiguredApp } from './helpers/create-app';
import { generateAdminToken, generateTestToken } from './helpers/auth';
import { clearE2eTables } from './helpers/seed';

const OWNER = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

async function createCheckingAccount(
  app: INestApplication,
  token: string,
  body: Record<string, unknown> = { accountType: 'CHECKING' },
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
    .expect(201);
  return res.body.accountId as string;
}

describe('Deposit / Withdraw (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const ORIGINAL_MAX_DEPOSIT = process.env.MAX_DEPOSIT;

  beforeAll(async () => {
    app = await createConfiguredApp();
    dataSource = app.get(DataSource);
  }, 60_000);

  beforeEach(async () => {
    await clearE2eTables(dataSource);
  });

  afterAll(async () => {
    if (ORIGINAL_MAX_DEPOSIT === undefined) {
      delete process.env.MAX_DEPOSIT;
    } else {
      process.env.MAX_DEPOSIT = ORIGINAL_MAX_DEPOSIT;
    }
    await app.close();
  });

  describe('Idempotency-Key requirement', () => {
    it('POST /deposit missing Idempotency-Key returns 400', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value: '1.000000' })
        .expect(400);
    });

    it('POST /withdraw missing Idempotency-Key returns 400', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value: '1.000000' })
        .expect(400);
    });
  });

  describe('Money validation', () => {
    it('POST /deposit rejects "0" as value (400)', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-dep-0')
        .send({ value: '0' })
        .expect(400);
    });

    it('POST /deposit rejects more than six fractional digits (400)', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-dep-7d')
        .send({ value: '1.1234567' })
        .expect(400);
    });

    it('POST /deposit rejects non-numeric value (400)', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-dep-bad')
        .send({ value: 'abc' })
        .expect(400);
    });

    it('POST /withdraw rejects invalid money strings (400)', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-w-bad')
        .send({ value: 'NaN' })
        .expect(400);
    });
  });

  describe('Ownership masking', () => {
    it('POST /deposit by non-owner returns 404', async () => {
      const ownerToken = generateTestToken(OWNER);
      const otherToken = generateTestToken(OTHER);
      const id = await createCheckingAccount(app, ownerToken);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${otherToken}`)
        .set('Idempotency-Key', 'k-other-dep')
        .send({ value: '5.000000' })
        .expect(404);
    });

    it('POST /withdraw by non-owner returns 404', async () => {
      const ownerToken = generateTestToken(OWNER);
      const otherToken = generateTestToken(OTHER);
      const id = await createCheckingAccount(app, ownerToken);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', 'k-self-dep')
        .send({ value: '50.000000' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${otherToken}`)
        .set('Idempotency-Key', 'k-other-w')
        .send({ value: '1.000000' })
        .expect(404);
    });
  });

  describe('Insufficient funds and daily limit', () => {
    it('POST /withdraw with insufficient funds returns 422', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-w-empty')
        .send({ value: '10.000000' })
        .expect(422);
    });

    it('POST /withdraw above daily limit returns 422 (single request)', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token, {
        accountType: 'CHECKING',
        dailyWithdrawalLimit: '50.000000',
      });
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-dl-dep')
        .send({ value: '1000.000000' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-dl-w-over')
        .send({ value: '100.000000' })
        .expect(422);
    });
  });

  describe('MAX_DEPOSIT cap', () => {
    it('POST /deposit value above MAX_DEPOSIT returns 400', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      process.env.MAX_DEPOSIT = '100';
      try {
        await request(app.getHttpServer())
          .post(`/accounts/${id}/deposit`)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', 'k-max-dep')
          .send({ value: '101.000000' })
          .expect(400);
      } finally {
        if (ORIGINAL_MAX_DEPOSIT === undefined) delete process.env.MAX_DEPOSIT;
        else process.env.MAX_DEPOSIT = ORIGINAL_MAX_DEPOSIT;
      }
    });
  });

  describe('Blocked accounts', () => {
    it('Deposit on a blocked account returns 403', async () => {
      const token = generateTestToken(OWNER);
      const admin = generateAdminToken();
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .patch(`/accounts/${id}/block`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-block-dep')
        .send({ value: '1.000000' })
        .expect(403);
    });

    it('Withdrawal on a blocked account returns 403', async () => {
      const token = generateTestToken(OWNER);
      const admin = generateAdminToken();
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-pre-block-dep')
        .send({ value: '100.000000' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/accounts/${id}/block`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-block-w')
        .send({ value: '1.000000' })
        .expect(403);
    });
  });

  describe('Idempotency', () => {
    it('Withdraw replay returns same transaction id and balance is not double-debited', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-w-replay-dep')
        .send({ value: '100.000000' })
        .expect(200);

      const a = await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-w-replay')
        .send({ value: '25.000000' })
        .expect(200);
      const b = await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-w-replay')
        .send({ value: '25.000000' })
        .expect(200);
      expect(a.body.transaction.transactionId).toBe(
        b.body.transaction.transactionId,
      );
      expect(b.body.balance).toBe('75.000000');
    });

    it('Withdraw same key with different body returns 409', async () => {
      const token = generateTestToken(OWNER);
      const id = await createCheckingAccount(app, token);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-w-conflict-dep')
        .send({ value: '100.000000' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-w-conflict')
        .send({ value: '10.000000' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/accounts/${id}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-w-conflict')
        .send({ value: '11.000000' })
        .expect(409);
    });
  });
});
