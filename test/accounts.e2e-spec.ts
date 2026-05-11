/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest JSON bodies are untyped */
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createConfiguredApp } from './helpers/create-app';
import { generateAdminToken, generateTestToken } from './helpers/auth';
import { clearE2eTables } from './helpers/seed';

const OWNER = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const UNKNOWN_ACC = '00000000-0000-0000-0000-0000000000aa';

describe('Accounts API (e2e)', () => {
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

  describe('POST /accounts', () => {
    it('returns 401 without Authorization', async () => {
      await request(app.getHttpServer())
        .post('/accounts')
        .send({ accountType: 'CHECKING' })
        .expect(401);
    });

    it('creates a CHECKING account and returns accountId (201)', async () => {
      const token = generateTestToken(OWNER);
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({ accountType: 'CHECKING' })
        .expect(201);
      expect(res.body.accountId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(res.body.personId).toBe(OWNER);
      expect(res.body.accountType).toBe(1);
      expect(res.body.balance).toBe('0.000000');
      expect(res.body.dailyWithdrawalLimit).toBe('500.000000');
      expect(res.body.activeFlag).toBe(true);
    });

    it('creates a SAVINGS account with custom daily limit', async () => {
      const token = generateTestToken(OWNER);
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          accountType: 'SAVINGS',
          dailyWithdrawalLimit: '250.500000',
        })
        .expect(201);
      expect(res.body.accountType).toBe(2);
      expect(res.body.dailyWithdrawalLimit).toBe('250.500000');
    });

    it('rejects invalid accountType (400)', async () => {
      const token = generateTestToken(OWNER);
      await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({ accountType: 'CRYPTO' })
        .expect(400);
    });

    it('rejects malformed dailyWithdrawalLimit (400)', async () => {
      const token = generateTestToken(OWNER);
      await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          accountType: 'CHECKING',
          dailyWithdrawalLimit: 'abc',
        })
        .expect(400);
    });

    it('rejects negative dailyWithdrawalLimit via class-validator (400)', async () => {
      const token = generateTestToken(OWNER);
      await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          accountType: 'CHECKING',
          dailyWithdrawalLimit: '-10',
        })
        .expect(400);
    });

    it('rejects dailyWithdrawalLimit above the service maximum (400)', async () => {
      const token = generateTestToken(OWNER);
      await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          accountType: 'CHECKING',
          dailyWithdrawalLimit: '1000000000001',
        })
        .expect(400);
    });

    it('rejects extra unknown fields with forbidNonWhitelisted (400)', async () => {
      const token = generateTestToken(OWNER);
      await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({ accountType: 'CHECKING', sneaky: true })
        .expect(400);
    });
  });

  describe('GET /accounts/:id', () => {
    it('returns 200 with expected fields for the owner', async () => {
      const token = generateTestToken(OWNER);
      const { body } = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({ accountType: 'CHECKING' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/accounts/${body.accountId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.accountId).toBe(body.accountId);
      expect(res.body.personId).toBe(OWNER);
      expect(res.body.balance).toBe('0.000000');
      expect(res.body.activeFlag).toBe(true);
    });

    it('returns 404 for non-owner (no enumeration leak)', async () => {
      const ownerToken = generateTestToken(OWNER);
      const otherToken = generateTestToken(OTHER);
      const { body } = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ accountType: 'CHECKING' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/accounts/${body.accountId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('returns 404 for unknown id', async () => {
      const token = generateTestToken(OWNER);
      await request(app.getHttpServer())
        .get(`/accounts/${UNKNOWN_ACC}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 400 for an invalid (non-UUID) id', async () => {
      const token = generateTestToken(OWNER);
      await request(app.getHttpServer())
        .get('/accounts/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('PATCH /accounts/:id/block and /unblock', () => {
    async function createOwned(): Promise<string> {
      const token = generateTestToken(OWNER);
      const { body } = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({ accountType: 'CHECKING' })
        .expect(201);
      return body.accountId as string;
    }

    it('admin can block an account (200) and customer is then 403 for deposit', async () => {
      const admin = generateAdminToken();
      const customer = generateTestToken(OWNER);
      const id = await createOwned();
      await request(app.getHttpServer())
        .patch(`/accounts/${id}/block`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/accounts/${id}/deposit`)
        .set('Authorization', `Bearer ${customer}`)
        .set('Idempotency-Key', 'blocked-dep-1')
        .send({ value: '1.000000' })
        .expect(403);
    });

    it('customer (no admin role) cannot block (403)', async () => {
      const customer = generateTestToken(OWNER);
      const id = await createOwned();
      await request(app.getHttpServer())
        .patch(`/accounts/${id}/block`)
        .set('Authorization', `Bearer ${customer}`)
        .expect(403);
    });

    it('admin can unblock and customer regains deposit ability', async () => {
      const admin = generateAdminToken();
      const customer = generateTestToken(OWNER);
      const id = await createOwned();
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
        .set('Authorization', `Bearer ${customer}`)
        .set('Idempotency-Key', 'unblocked-dep-1')
        .send({ value: '1.000000' })
        .expect(200);
    });

    it('block on unknown account returns 404 for admin', async () => {
      const admin = generateAdminToken();
      await request(app.getHttpServer())
        .patch(`/accounts/${UNKNOWN_ACC}/block`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(404);
    });

    it('unblock on unknown account returns 404 for admin', async () => {
      const admin = generateAdminToken();
      await request(app.getHttpServer())
        .patch(`/accounts/${UNKNOWN_ACC}/unblock`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(404);
    });

    it('customer (no admin role) cannot unblock (403)', async () => {
      const customer = generateTestToken(OWNER);
      const id = await createOwned();
      await request(app.getHttpServer())
        .patch(`/accounts/${id}/unblock`)
        .set('Authorization', `Bearer ${customer}`)
        .expect(403);
    });
  });

  describe('SAVINGS visibility end-to-end', () => {
    it('SAVINGS account is created and visible on GET with accountType=2', async () => {
      const token = generateTestToken(OWNER);
      const { body } = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({ accountType: 'SAVINGS' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .get(`/accounts/${body.accountId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.accountType).toBe(2);
    });
  });
});
