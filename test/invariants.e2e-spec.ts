/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest JSON bodies are untyped */
/**
 * Property / invariant tests at the HTTP boundary.
 *
 * These tests describe behaviors that MUST hold regardless of how the engine
 * underneath is implemented (TypeORM, raw SQL, different locking strategy,
 * different idempotency storage, etc.). They speak only through the public
 * API and final account state, so a complete engine rewrite that keeps the
 * contract correct will keep these tests green.
 *
 *  P1. Conservation of money:
 *      For any valid sequence of accepted deposits and withdrawals,
 *      balance == sum(accepted deposit values) - sum(accepted withdrawal values).
 *
 *  P2. Idempotency stability:
 *      For an idempotency key K applied N times with the same body, exactly
 *      one transaction row exists, all successful calls share one transactionId,
 *      and the balance reflects exactly one application of the body.
 *
 *  P3. Concurrent daily-limit safety:
 *      For two parallel withdrawals whose sum exceeds the daily limit, exactly
 *      one succeeds, and the resulting balance reflects only the successful one.
 */
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import request from 'supertest';
import { createConfiguredApp } from './helpers/create-app';
import { generateTestToken } from './helpers/auth';
import { clearE2eTables } from './helpers/seed';

const OWNER = '00000000-0000-0000-0000-000000000001';

async function createAccount(
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

async function getBalance(
  app: INestApplication,
  token: string,
  id: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/accounts/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.balance as string;
}

describe('Property / invariant tests (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createConfiguredApp();
    dataSource = app.get(DataSource);
  }, 60_000);

  beforeEach(async () => {
    await clearE2eTables(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('P1. Conservation of money', () => {
    it('balance == sum(accepted deposits) - sum(accepted withdrawals) for any mixed sequence', async () => {
      const token = generateTestToken(OWNER);
      const id = await createAccount(app, token, {
        accountType: 'CHECKING',
        // High daily limit so the property is about money, not about limit policy.
        dailyWithdrawalLimit: '1000000000000',
      });

      // Mixed sequence including high-precision amounts. Withdrawals that
      // would overdraw are still issued; whether each is accepted is part of
      // the test (the invariant ignores rejected ops).
      const ops: Array<{ kind: 'D' | 'W'; value: string }> = [
        { kind: 'D', value: '100.000000' },
        { kind: 'D', value: '50.500000' },
        { kind: 'W', value: '10.000000' },
        { kind: 'D', value: '0.000001' },
        { kind: 'W', value: '5.250000' },
        { kind: 'D', value: '1000.123456' },
        { kind: 'W', value: '500.000000' },
        { kind: 'W', value: '100.999999' },
        { kind: 'D', value: '0.000005' },
        { kind: 'W', value: '1.000000' },
        // Try to overdraw — should be rejected (422) and NOT counted.
        { kind: 'W', value: '999999999.999999' },
        { kind: 'D', value: '7.777777' },
      ];

      let expected = new Decimal(0);
      let accepted = 0;
      let rejected = 0;

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const path = op.kind === 'D' ? 'deposit' : 'withdraw';
        const res = await request(app.getHttpServer())
          .post(`/accounts/${id}/${path}`)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', `p1-${i}`)
          .send({ value: op.value });

        if (res.status === 200) {
          const sign = op.kind === 'D' ? 1 : -1;
          expected = expected.plus(new Decimal(op.value).mul(sign));
          accepted++;
        } else {
          rejected++;
        }
      }

      // Smoke checks on the test itself: we must have exercised both paths.
      expect(accepted).toBeGreaterThan(0);
      expect(rejected).toBeGreaterThan(0);

      const finalBalance = await getBalance(app, token, id);
      expect(new Decimal(finalBalance).eq(expected)).toBe(true);
    });
  });

  describe('P2. Idempotency stability', () => {
    it('N replays of same key+body => exactly one transaction row, one shared transactionId, single-apply balance', async () => {
      const token = generateTestToken(OWNER);
      const id = await createAccount(app, token);

      const key = 'p2-key';
      const value = '42.000000';
      const N = 6;

      const responses = await Promise.all(
        Array.from({ length: N }, () =>
          request(app.getHttpServer())
            .post(`/accounts/${id}/deposit`)
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', key)
            .send({ value }),
        ),
      );

      for (const r of responses) {
        expect(r.status).toBe(200);
      }

      const ids = responses.map(
        (r) => r.body.transaction.transactionId as string,
      );
      expect(new Set(ids).size).toBe(1);

      const stmt = await request(app.getHttpServer())
        .get(`/accounts/${id}/statement?limit=200`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const rowsForKey = stmt.body.items.filter(
        (it: { idempotencyKey?: string }) => it.idempotencyKey === key,
      );
      expect(rowsForKey.length).toBe(1);

      const finalBalance = await getBalance(app, token, id);
      expect(new Decimal(finalBalance).eq(value)).toBe(true);
    });

    it('replay is independent across (accountId, type) — same key works on a different account and for the opposite type', async () => {
      const token = generateTestToken(OWNER);
      const idA = await createAccount(app, token);
      const idB = await createAccount(app, token);
      const sharedKey = 'p2-shared';

      // Same key on two different accounts — both succeed.
      const depA = await request(app.getHttpServer())
        .post(`/accounts/${idA}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', sharedKey)
        .send({ value: '10.000000' })
        .expect(200);
      const depB = await request(app.getHttpServer())
        .post(`/accounts/${idB}/deposit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', sharedKey)
        .send({ value: '20.000000' })
        .expect(200);
      expect(depA.body.transaction.transactionId).not.toBe(
        depB.body.transaction.transactionId,
      );
      expect(await getBalance(app, token, idA)).toBe('10.000000');
      expect(await getBalance(app, token, idB)).toBe('20.000000');

      // Same key for the opposite type on the same account — also succeeds.
      const withdrawA = await request(app.getHttpServer())
        .post(`/accounts/${idA}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', sharedKey)
        .send({ value: '3.000000' })
        .expect(200);
      expect(withdrawA.body.transaction.transactionId).not.toBe(
        depA.body.transaction.transactionId,
      );
      expect(await getBalance(app, token, idA)).toBe('7.000000');
    });
  });

  describe('P3. Concurrent daily-limit safety', () => {
    const ITERATIONS = 5;

    it(`across ${ITERATIONS} fresh accounts: two parallel withdrawals over the limit => exactly one 200, exactly one 422, balance reflects only the accepted one`, async () => {
      const token = generateTestToken(OWNER);

      for (let i = 0; i < ITERATIONS; i++) {
        const id = await createAccount(app, token, {
          accountType: 'CHECKING',
          dailyWithdrawalLimit: '1200.000000',
        });
        await request(app.getHttpServer())
          .post(`/accounts/${id}/deposit`)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', `p3-dep-${i}`)
          .send({ value: '10000.000000' })
          .expect(200);

        const [r1, r2] = await Promise.all([
          request(app.getHttpServer())
            .post(`/accounts/${id}/withdraw`)
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', `p3-w1-${i}`)
            .send({ value: '800.000000' }),
          request(app.getHttpServer())
            .post(`/accounts/${id}/withdraw`)
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', `p3-w2-${i}`)
            .send({ value: '800.000000' }),
        ]);

        const statuses = [r1.status, r2.status].sort();
        expect(statuses).toEqual([200, 422]);

        // Balance reflects ONLY the accepted withdrawal: 10000 - 800 = 9200.
        const balance = await getBalance(app, token, id);
        expect(new Decimal(balance).eq('9200.000000')).toBe(true);
      }
    });

    it('concurrent deposits never lose updates: balance equals sum of all 5 parallel deposits', async () => {
      const token = generateTestToken(OWNER);
      const id = await createAccount(app, token);

      const values = ['1.000000', '2.000000', '3.000000', '4.000000', '5.000000'];
      const responses = await Promise.all(
        values.map((v, i) =>
          request(app.getHttpServer())
            .post(`/accounts/${id}/deposit`)
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', `p3-conc-dep-${i}`)
            .send({ value: v }),
        ),
      );
      for (const r of responses) {
        expect(r.status).toBe(200);
      }

      const expected = values.reduce(
        (acc, v) => acc.plus(v),
        new Decimal(0),
      );
      const final = await getBalance(app, token, id);
      expect(new Decimal(final).eq(expected)).toBe(true);
    });
  });
});
