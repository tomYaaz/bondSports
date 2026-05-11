import * as jwt from 'jsonwebtoken';

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET must be set (e.g. via .env) for e2e tests');
  }
  return secret;
}

export function generateTestToken(personId: string): string {
  return jwt.sign({ personId }, requireSecret(), { expiresIn: '1h' });
}

export function generateAdminToken(
  personId = '00000000-0000-0000-0000-000000000099',
): string {
  return jwt.sign({ personId, roles: ['admin'] }, requireSecret(), {
    expiresIn: '1h',
  });
}
