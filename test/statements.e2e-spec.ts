/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest JSON bodies are untyped */
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createConfiguredApp } from './helpers/create-app';
import { generateTestToken } from './helpers/auth';
import { clearE2eTables } from './helpers/seed';

const OWNER = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

async function createAccount(
  app: INestApplication,
  token: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send({ accountType: 'CHECKING' })
    .expect(201);
  return res.body.accountId as string;
}

async function deposit(
  app: INestApplication,
  token: string,
  id: string,
  key: string,
  value: string,
): Promise<{ transactionId: string }> {
  const res = await request(app.getHttpServer())
    .post(`/accounts/${id}/deposit`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ value })
    .expect(200);
  return res.body.transaction as { transactionId: string };
}

async function withdraw(
  app: INestApplication,
  token: string,
  id: string,
  key: string,
  value: string,
): Promise<{ transactionId: string }> {
  const res = await request(app.getHttpServer())
    .post(`/accounts/${id}/withdraw`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ value })
    .expect(200);
  return res.body.transaction as { transactionId: string };
}

async function rewriteTransactionDate(
  ds: DataSource,
  txId: string,
  isoDate: string,
): Promise<void> {
  await ds.query(
    `UPDATE "transactions" SET "transactionDate" = $1 WHERE "transactionId" = $2`,
    [new Date(isoDate), txId],
  );
}

describe('Statements (e2e)', () => {
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

  it('returns 404 for a non-owner', async () => {
    const ownerToken = generateTestToken(OWNER);
    const otherToken = generateTestToken(OTHER);
    const id = await createAccount(app, ownerToken);
    await request(app.getHttpServer())
      .get(`/accounts/${id}/statement`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('returns items in DESC order by default (newest first)', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    const tx1 = await deposit(app, token, id, 'stmt-d1', '1.000000');
    const tx2 = await deposit(app, token, id, 'stmt-d2', '2.000000');
    const tx3 = await deposit(app, token, id, 'stmt-d3', '3.000000');

    await rewriteTransactionDate(
      dataSource,
      tx1.transactionId,
      '2026-01-01T12:00:00.000Z',
    );
    await rewriteTransactionDate(
      dataSource,
      tx2.transactionId,
      '2026-01-02T12:00:00.000Z',
    );
    await rewriteTransactionDate(
      dataSource,
      tx3.transactionId,
      '2026-01-03T12:00:00.000Z',
    );

    const res = await request(app.getHttpServer())
      .get(`/accounts/${id}/statement`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const items = res.body.items as Array<{ transactionId: string }>;
    expect(items.map((i) => i.transactionId)).toEqual([
      tx3.transactionId,
      tx2.transactionId,
      tx1.transactionId,
    ]);
  });

  it('from / to filters honor UTC date-only boundaries (inclusive start, exclusive end)', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    const tx1 = await deposit(app, token, id, 'b-1', '1.000000');
    const tx2 = await deposit(app, token, id, 'b-2', '2.000000');
    const tx3 = await deposit(app, token, id, 'b-3', '3.000000');

    await rewriteTransactionDate(
      dataSource,
      tx1.transactionId,
      '2026-01-31T23:59:59.000Z',
    );
    await rewriteTransactionDate(
      dataSource,
      tx2.transactionId,
      '2026-02-01T00:00:00.000Z',
    );
    await rewriteTransactionDate(
      dataSource,
      tx3.transactionId,
      '2026-02-28T23:59:59.000Z',
    );

    const res = await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?from=2026-02-01&to=2026-02-28&limit=50`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const items = res.body.items as Array<{ transactionId: string }>;
    const ids = items.map((i) => i.transactionId);
    expect(ids).toContain(tx2.transactionId);
    expect(ids).toContain(tx3.transactionId);
    expect(ids).not.toContain(tx1.transactionId);
  });

  it('respects limit and returns nextCursor when more rows exist', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    for (let i = 0; i < 5; i++) {
      await deposit(app, token, id, `pg-${i}`, '1.000000');
    }
    const res = await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?limit=2`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.hasNextPage).toBe(true);
    expect(typeof res.body.nextCursor).toBe('string');
    expect(res.body.nextCursor.length).toBeGreaterThan(0);
  });

  it('second page using cursor continues with no duplicates and no gaps', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const tx = await deposit(app, token, id, `cp-${i}`, '1.000000');
      created.push(tx.transactionId);
    }

    const p1 = await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?limit=2`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const p2 = await request(app.getHttpServer())
      .get(
        `/accounts/${id}/statement?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const p3 = await request(app.getHttpServer())
      .get(
        `/accounts/${id}/statement?limit=2&cursor=${encodeURIComponent(p2.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(p1.body.hasNextPage).toBe(true);
    expect(p2.body.hasNextPage).toBe(true);
    expect(p3.body.hasNextPage).toBe(false);

    const seen = [...p1.body.items, ...p2.body.items, ...p3.body.items].map(
      (i: { transactionId: string }) => i.transactionId,
    );
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen).size).toBe(created.length);
  });

  it('rejects invalid cursor with 400', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?cursor=not-valid-base64-cursor`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects invalid limit (0) with 400', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?limit=0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects invalid order value with 400', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?order=FOO`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects from > to with 400', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?from=2026-02-02&to=2026-01-01`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('filters by transaction type', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    await deposit(app, token, id, 'ft-d1', '100.000000');
    await deposit(app, token, id, 'ft-d2', '50.000000');
    await withdraw(app, token, id, 'ft-w1', '10.000000');

    const depositsOnly = await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?type=DEPOSIT`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const withdrawalsOnly = await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?type=WITHDRAWAL`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(depositsOnly.body.items.length).toBe(2);
    expect(
      (depositsOnly.body.items as Array<{ type: string }>).every(
        (i) => i.type === 'DEPOSIT',
      ),
    ).toBe(true);

    expect(withdrawalsOnly.body.items.length).toBe(1);
    expect(withdrawalsOnly.body.items[0].type).toBe('WITHDRAWAL');
  });

  it('filters by inclusive minValue and maxValue', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    const low = await deposit(app, token, id, 'amt-1', '1.000000');
    const mid = await deposit(app, token, id, 'amt-2', '5.000000');
    const high = await deposit(app, token, id, 'amt-3', '10.000000');

    const res = await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?minValue=5.000000&maxValue=10.000000`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ids = (res.body.items as Array<{ transactionId: string }>).map(
      (i) => i.transactionId,
    );
    expect(ids.sort()).toEqual([mid.transactionId, high.transactionId].sort());
    expect(ids).not.toContain(low.transactionId);
  });

  it('rejects invalid transaction type with 400', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?type=INVALID`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects minValue greater than maxValue with 400', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    await request(app.getHttpServer())
      .get(`/accounts/${id}/statement?minValue=10&maxValue=5`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('omitted from/to returns full history (default order)', async () => {
    const token = generateTestToken(OWNER);
    const id = await createAccount(app, token);
    await deposit(app, token, id, 'hist-1', '1.000000');
    await deposit(app, token, id, 'hist-2', '2.000000');
    const res = await request(app.getHttpServer())
      .get(`/accounts/${id}/statement`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items.length).toBe(2);
  });
});
