/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access -- supertest JSON bodies are untyped */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createConfiguredApp } from './helpers/create-app';

describe('Request id propagation in error responses (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createConfiguredApp();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('includes a UUID requestId in the error body when no x-request-id header is sent', async () => {
    const res = await request(app.getHttpServer())
      .post('/validation_smoke')
      .send({})
      .expect(400);
    expect(res.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('echoes the client-supplied x-request-id in the error body', async () => {
    const myId = 'req-id-from-client-abc-123';
    const res = await request(app.getHttpServer())
      .post('/validation_smoke')
      .set('x-request-id', myId)
      .send({})
      .expect(400);
    expect(res.body.requestId).toBe(myId);
  });

  it('generates distinct request ids across calls when client does not send one', async () => {
    const a = await request(app.getHttpServer())
      .post('/validation_smoke')
      .send({})
      .expect(400);
    const b = await request(app.getHttpServer())
      .post('/validation_smoke')
      .send({})
      .expect(400);
    expect(a.body.requestId).not.toBe(b.body.requestId);
  });
});
