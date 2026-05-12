/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access -- supertest JSON bodies are untyped */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createConfiguredApp } from './helpers/create-app';
import { generateTestToken } from './helpers/auth';

const PERSON = '00000000-0000-0000-0000-000000000001';

describe('JWT auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createConfiguredApp();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /protected/ping without token returns 401', async () => {
    await request(app.getHttpServer()).get('/protected/ping').expect(401);
  });

  it('GET /protected/ping with valid token returns { ok: true }', async () => {
    const token = generateTestToken(PERSON);
    const res = await request(app.getHttpServer())
      .get('/protected/ping')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /protected/ping with malformed Bearer returns 401', async () => {
    await request(app.getHttpServer())
      .get('/protected/ping')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('OpenAPI JSON path (/api/docs-json) is reachable without JWT', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json');
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
    expect(res.body.openapi ?? res.body.swagger).toBeDefined();
  });

  it('Swagger UI (/api/docs) is reachable without JWT', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs')
      .redirects(1);
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Swagger');
  });
});
