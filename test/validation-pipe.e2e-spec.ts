/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest JSON bodies are untyped */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createConfiguredApp } from './helpers/create-app';

describe('Global ValidationPipe + HttpExceptionFilter (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createConfiguredApp();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('POST /_validation-smoke with valid body returns 201/200 and echoes label', async () => {
    const res = await request(app.getHttpServer())
      .post('/_validation-smoke')
      .send({ label: 'hello' });
    expect([200, 201]).toContain(res.status);
    expect(res.body).toEqual({ ok: true, label: 'hello' });
  });

  it('POST /_validation-smoke with missing label returns 400 with structured filter body', async () => {
    const res = await request(app.getHttpServer())
      .post('/_validation-smoke')
      .send({})
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(typeof res.body.timestamp).toBe('string');
    expect(typeof res.body.path).toBe('string');
    expect(typeof res.body.requestId).toBe('string');
  });

  it('POST /_validation-smoke with extra unknown field is rejected (forbidNonWhitelisted)', async () => {
    await request(app.getHttpServer())
      .post('/_validation-smoke')
      .send({ label: 'ok', extra: 'nope' })
      .expect(400);
  });
});
