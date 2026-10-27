import { trpcServer } from '@hono/trpc-server';
import { AppError, resolveEnginePlugins, toAppError, type AuthProvider, type EnginePlugins } from '@anumat/core';
import { mergePluginRouters, openApiDocument, type AnumatServices, type TrpcContext } from '@anumat/contract';
import type { AppContext } from '@anumat/engine';
import { log } from '@anumat/engine';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { AnyRouter } from '@trpc/server';
import { TRPCError } from '@trpc/server';
import { createOpenApiFetchHandler } from 'trpc-to-openapi';
import { createServices } from '../services';
import { apiKeyAuth, authenticate, rateLimit } from './middleware';
import { v1 } from './routes';

export type AppEnv = { Variables: { requestId: string; principal: string } };

export type ApiPlugins = Partial<EnginePlugins> & {
  auth?: AuthProvider;
  routers?: AnyRouter[];
};

type CreateAppOptions = {
  ctx?: AppContext;
  plugins?: ApiPlugins;
};

const unavailableServices: AnumatServices = new Proxy({} as AnumatServices, {
  get() {
    return () => Promise.reject(new AppError('internal', 'Anumat is not configured'));
  },
});

const denyAll: AuthProvider = {
  async authenticate() {
    return undefined;
  },
};

function isAppContext(value: AppContext | CreateAppOptions): value is AppContext {
  return 'db' in value && 'config' in value && 'blobs' in value;
}

export function createApp(input?: AppContext | CreateAppOptions) {
  const options: CreateAppOptions = input === undefined ? {} : isAppContext(input) ? { ctx: input } : input;
  const ctx = options.ctx;
  if (ctx) ctx.plugins = resolveEnginePlugins({ ...ctx.plugins, ...options.plugins });
  const auth = options.plugins?.auth ?? (ctx ? apiKeyAuth(ctx.config.apiKeys) : denyAll);
  const limiter = rateLimit(ctx?.config.rateLimitPerMinute ?? 120);
  const services = ctx ? createServices(ctx) : unavailableServices;
  const router = mergePluginRouters(options.plugins?.routers ?? []);

  const createContext = async (_opts: unknown, c: { req: { header(name: string): string | undefined } }): Promise<TrpcContext> => {
    const apiKey = c.req.header('authorization');
    const principal = await auth.authenticate(apiKey);
    if (principal) {
      const retryAfter = limiter.consume(principal.principal);
      if (retryAfter !== undefined) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Rate limit of ${ctx?.config.rateLimitPerMinute ?? 120} requests per minute exceeded`,
        });
      }
    }
    return { apiKey, principal: principal?.principal, services };
  };

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
      llm_mode: ctx?.config.llmMode ?? 'live',
      ocr: ctx?.config.firecrawlApiKey ? 'configured' : 'missing',
    };
    if (!ctx) return c.json({ status: 'not_ready', checks: { database: 'down', ...checks } }, 503);
    try {
      await ctx.db.$queryRaw`SELECT 1`;
    } catch {
      return c.json({ status: 'not_ready', checks: { database: 'down', ...checks } }, 503);
    }
    return c.json({ status: 'ready', checks: { database: 'up', ...checks } });
  });

  app.use('/v1/*', authenticate(ctx?.config.apiKeys ?? []), limiter.middleware);
  if (ctx) app.route('/v1', v1(ctx));

  app.use(
    '/trpc/*',
    trpcServer({
      router,
      endpoint: '/trpc',
      createContext: (_opts, c) => createContext(_opts, c),
    }),
  );

  app.get('/api/v1/openapi.json', (c) => {
    const url = new URL(c.req.url);
    return c.json(openApiDocument(`${url.origin}/api/v1`));
  });
  app.all('/api/v1/*', (c) =>
    createOpenApiFetchHandler({
      endpoint: '/api/v1',
      router,
      createContext: () => createContext(undefined, c),
      req: c.req.raw,
      responseMeta: ({ paths, errors }) => {
        if (errors.length > 0) return {};
        const path = paths?.[0] ?? '';
        if (c.req.method === 'POST' && (path === 'payers.create' || path === 'sources.create')) {
          return { status: 201 };
        }
        return {};
      },
    }),
  );

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
