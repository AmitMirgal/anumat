import { createHash, timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { AppError } from '../errors';
import type { AppEnv } from './app';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export function authenticate(keys: { name: string; key: string }[]) {
  const known = keys.map(({ name, key }) => ({ name, digest: sha256(key) }));
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const digest = sha256(token);
    const match = known.find((k) => timingSafeEqual(k.digest, digest));
    if (!token || !match) throw new AppError('unauthorized', 'Missing or invalid bearer API key');
    c.set('principal', match.name);
    await next();
  });
}

export function rateLimit(perMinute: number) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return createMiddleware<AppEnv>(async (c, next) => {
    const now = Date.now();
    const principal = c.get('principal');
    const window = windows.get(principal);
    if (!window || now - window.startedAt >= 60_000) {
      windows.set(principal, { startedAt: now, count: 1 });
    } else if (++window.count > perMinute) {
      const retryAfter = Math.ceil((window.startedAt + 60_000 - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      throw new AppError('rate_limited', `Rate limit of ${perMinute} requests per minute exceeded`, {
        retry_after_seconds: retryAfter,
      });
    }
    await next();
  });
}
