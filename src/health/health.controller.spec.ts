import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

function makeDataSource(
  query: jest.Mock,
): DataSource {
  return { query } as unknown as DataSource;
}

describe('HealthController', () => {
  it('runs SELECT 1 and returns { status: "ok" }', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const ctl = new HealthController(makeDataSource(query));
    await expect(ctl.getHealth()).resolves.toEqual({ status: 'ok' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('propagates errors when DB is unreachable', async () => {
    const query = jest.fn().mockRejectedValue(new Error('db down'));
    const ctl = new HealthController(makeDataSource(query));
    await expect(ctl.getHealth()).rejects.toThrow('db down');
  });
});
