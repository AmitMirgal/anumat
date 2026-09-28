import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { AppContext } from '../context';
import { toAppError } from '../errors';
import { log } from '../log';
import { authenticate, rateLimit } from './middleware';
import { v1 } from './routes';

export type AppEnv = { Variables: { requestId: string; principal: string } };

export function createApp(ctx: AppContext) {
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    log.info(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      },
      'request',
    );
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/ready', async (c) => {
    const checks = {
      llm_mode: ctx.config.llmMode,
      ocr: ctx.config.firecrawlApiKey ? 'configured' : 'missing',
    };
    try {
      await ctx.sql`select 1`;
    } catch {
      return c.json({ status: 'not_ready', checks: { database: 'down', ...checks } }, 503);
    }
    return c.json({ status: 'ready', checks: { database: 'up', ...checks } });
  });

  app.use('/v1/*', authenticate(ctx.config.apiKeys), rateLimit(ctx.config.rateLimitPerMinute));
  app.route('/v1', v1(ctx));

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'not_found',
          message: `No route for ${c.req.method} ${c.req.path}`,
          request_id: c.get('requestId'),
        },
      },
      404,
    ),
  );
  app.onError((err, c) => {
    const error = toAppError(err);
    if (error.status >= 500) log.error({ err, requestId: c.get('requestId') }, 'request failed');
    return c.json(
      {
        error: { code: error.code, message: error.message, details: error.details, request_id: c.get('requestId') },
      },
      error.status,
    );
  });

  return app;
}
