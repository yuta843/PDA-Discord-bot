import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}
export function createOAuthState(secret: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ nonce: randomBytes(18).toString('base64url'), expiresAt: now + STATE_TTL_MS }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyOAuthState(value: string, secret: string, now = Date.now()) {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return false;

  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      nonce?: unknown;
      expiresAt?: unknown;
    };
    return typeof parsed.nonce === 'string' && typeof parsed.expiresAt === 'number' && parsed.expiresAt >= now;
  } catch {
    return false;
  }
}
