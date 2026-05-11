/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest JSON bodies are untyped */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { generateAdminToken, generateTestToken } from './helpers/auth';
import { createConfiguredApp } from './helpers/create-app';
import { clearE2eTables } from './helpers/seed';

const OWNER = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

describe('Account API (e2e)', () => {
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

  it('GET /health is public', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('lifecycle: create → deposit → withdraw → statement → block → deposit 403', async () => {
    const token = generateTestToken(OWNER);
    const admin = generateAdminToken();

    const createRes = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountType: 'CHECKING', dailyWithdrawalLimit: '1000.000000' })
      .expect(201);

    const accountId = createRes.body.accountId as string;

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'life-dep-1')
      .send({ value: '500.000000' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/withdraw`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'life-w-1')
      .send({ value: '100.000000' })
      .expect(200);

    const today = new Date().toISOString().slice(0, 10);
    const stmt = await request(app.getHttpServer())
      .get(
        `/accounts/${accountId}/statement?from=${today}&to=${today}&limit=50`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(stmt.body.items)).toBe(true);
    expect(stmt.body.items.length).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/block`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'life-dep-blocked')
      .send({ value: '1.000000' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/withdraw`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'life-w-blocked')
      .send({ value: '1.000000' })
      .expect(403);
  });

  it('admin unblock restores deposits', async () => {
    const token = generateTestToken(OWNER);
    const admin = generateAdminToken();

    const { body } = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountType: 'CHECKING' })
      .expect(201);
    const id = body.accountId as string;

    await request(app.getHttpServer())
      .patch(`/accounts/${id}/block`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/accounts/${id}/unblock`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/accounts/${id}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'unblock-dep')
      .send({ value: '5.000000' })
      .expect(200);
  });

  it('non-owner cannot withdraw (404)', async () => {
    const ownerToken = generateTestToken(OWNER);
    const otherToken = generateTestToken(OTHER);

    const { body } = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ accountType: 'CHECKING' })
      .expect(201);
    const accountId = body.accountId as string;

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', 'own-dep-1')
      .send({ value: '50.000000' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/withdraw`)
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Idempotency-Key', 'other-w-1')
      .send({ value: '1.000000' })
      .expect(404);
  });

  it('customer cannot block (403)', async () => {
    const token = generateTestToken(OWNER);
    const { body } = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountType: 'CHECKING' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/accounts/${body.accountId}/block`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('concurrent withdrawals: one succeeds when pair exceeds daily limit', async () => {
    const token = generateTestToken(OWNER);
    const { body } = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountType: 'CHECKING',
        dailyWithdrawalLimit: '1200.000000',
      })
      .expect(201);
    const accountId = body.accountId as string;

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'conc-dep')
      .send({ value: '10000.000000' })
      .expect(200);

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/accounts/${accountId}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'conc-k1')
        .send({ value: '800.000000' }),
      request(app.getHttpServer())
        .post(`/accounts/${accountId}/withdraw`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'conc-k2')
        .send({ value: '800.000000' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 422]);
  });

  it('idempotency replay returns same outcome without double-credit', async () => {
    const token = generateTestToken(OWNER);
    const { body } = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountType: 'CHECKING' })
      .expect(201);
    const accountId = body.accountId as string;

    const key = 'idem-replay-1';
    const payload = { value: '25.000000' };

    const a = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    const b = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    expect(a.body.transaction.transactionId).toBe(
      b.body.transaction.transactionId,
    );
    expect(b.body.balance).toBe('25.000000');
  });

  it('idempotency conflict when same key and different body (409)', async () => {
    const token = generateTestToken(OWNER);
    const { body } = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountType: 'CHECKING' })
      .expect(201);
    const accountId = body.accountId as string;

    const key = 'idem-conflict-1';
    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ value: '10.000000' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ value: '11.000000' })
      .expect(409);
  });

  it('daily withdrawal total uses UTC day bucket (prior-day row excluded)', async () => {
    const token = generateTestToken(OWNER);
    const { body } = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountType: 'CHECKING',
        dailyWithdrawalLimit: '250.000000',
      })
      .expect(201);
    const accountId = body.accountId as string;

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/deposit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'utc-dep')
      .send({ value: '10000.000000' })
      .expect(200);

    const first = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/withdraw`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'utc-w1')
      .send({ value: '200.000000' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/withdraw`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'utc-w-same-day')
      .send({ value: '200.000000' })
      .expect(422);

    const txId = first.body.transaction.transactionId as string;
    const yesterday = new Date();
    yesterday.setUTCHours(12, 0, 0, 0);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    await dataSource.query(
      `UPDATE "transactions" SET "transactionDate" = $1 WHERE "transactionId" = $2`,
      [yesterday, txId],
    );

    await request(app.getHttpServer())
      .post(`/accounts/${accountId}/withdraw`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'utc-w2')
      .send({ value: '200.000000' })
      .expect(200);
  });

  it('statement rejects from > to (400)', async () => {
    const token = generateTestToken(OWNER);
    const { body } = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountType: 'CHECKING' })
      .expect(201);

    await request(app.getHttpServer())
      .get(
        `/accounts/${body.accountId}/statement?from=2026-02-02&to=2026-01-01`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
