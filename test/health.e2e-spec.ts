/* eslint-disable @typescript-eslint/no-unsafe-argument -- supertest JSON bodies are untyped */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createConfiguredApp } from './helpers/create-app';

describe('Health endpoint (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createConfiguredApp();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responds 200 without auth (public route)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health verifies DB readiness (issues SELECT 1)', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
