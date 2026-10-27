import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthProvider } from '@anumat/core';
import { AppError } from '@anumat/core';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './app';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export function apiKeyAuth(keys: { name: string; key: string }[]): AuthProvider {
  const known = keys.map(({ name, key }) => ({ name, digest: sha256(key) }));
  return {
    async authenticate(authorization) {
      const header = authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      if (!token) return undefined;
      const digest = sha256(token);
      const match = known.find((key) => timingSafeEqual(key.digest, digest));
      return match ? { principal: match.name } : undefined;
    },
  };
}

export function authenticate(keys: { name: string; key: string }[]) {
  const auth = apiKeyAuth(keys);
  return createMiddleware<AppEnv>(async (c, next) => {
    const match = await auth.authenticate(c.req.header('authorization'));
    if (!match) throw new AppError('unauthorized', 'Missing or invalid bearer API key');
    c.set('principal', match.principal);
    await next();
  });
}

export function rateLimit(perMinute: number) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  const consume = (principal: string): number | undefined => {
    const now = Date.now();
    const window = windows.get(principal);
    if (!window || now - window.startedAt >= 60_000) {
      windows.set(principal, { startedAt: now, count: 1 });
      return undefined;
    }
    window.count += 1;
    if (window.count > perMinute) return Math.ceil((window.startedAt + 60_000 - now) / 1000);
    return undefined;
  };
  const middleware = createMiddleware<AppEnv>(async (c, next) => {
    const retryAfter = consume(c.get('principal'));
    if (retryAfter !== undefined) {
      c.header('Retry-After', String(retryAfter));
      throw new AppError('rate_limited', `Rate limit of ${perMinute} requests per minute exceeded`, {
        retry_after_seconds: retryAfter,
      });
    }
    await next();
  });
  return { consume, middleware };
}
