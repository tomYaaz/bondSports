import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-unit-only';
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  it('throws when JWT_SECRET is missing at construction', () => {
    const prev = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(() => new JwtStrategy()).toThrow(/JWT_SECRET/);
    } finally {
      process.env.JWT_SECRET = prev;
    }
  });

  it('validate() maps personId from payload', () => {
    const s = new JwtStrategy();
    const out = s.validate({ personId: 'p-1' });
    expect(out.personId).toBe('p-1');
  });

  it('validate() preserves a roles array', () => {
    const s = new JwtStrategy();
    const out = s.validate({ personId: 'p-1', roles: ['admin', 'staff'] });
    expect(out.roles).toEqual(['admin', 'staff']);
  });

  it('validate() normalizes missing or non-array roles to []', () => {
    const s = new JwtStrategy();
    expect(s.validate({ personId: 'p-1' }).roles).toEqual([]);
    expect(
      s.validate({
        personId: 'p-1',
        roles: 'admin' as unknown as string[],
      }).roles,
    ).toEqual([]);
    expect(
      s.validate({
        personId: 'p-1',
        roles: null as unknown as string[],
      }).roles,
    ).toEqual([]);
  });
});
