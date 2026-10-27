import type { Context } from 'hono';
import { Hono } from 'hono';
import { AppError } from '@anumat/core';
import {
  id,
  NewPayer,
  NewSource,
  pageQuery,
  Rejection,
  VersionFilter,
} from '@anumat/contract';
import {
  approveVersion,
  checkSource,
  diffForVersion,
  getDiff,
  getPublishedPolicy,
  getPublishedVersion,
  getSource,
  getVersion,
  listPayers,
  listPublishedVersions,
  listSources,
  listVersions,
  registerPayer,
  registerSource,
  rejectVersion,
  type AppContext,
} from '@anumat/engine';
import { z } from 'zod';
import type { AppEnv } from './app';
import { diffDto, pageDto, payerDto, publishedDto, sourceDto, versionDto, watchRunDto } from './dto';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('validation_failed', 'Request validation failed', {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}

async function jsonBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await c.req.json().catch(() => {
    throw new AppError('validation_failed', 'Request body must be a JSON object');
  });
  return parse(schema, raw);
}

export function v1(ctx: AppContext) {
  const { db } = ctx;
  const routes = new Hono<AppEnv>();

  routes.post('/payers', async (c) => c.json(payerDto(await registerPayer(db, await jsonBody(c, NewPayer))), 201));
  routes.get('/payers', async (c) => c.json(pageDto(await listPayers(db, parse(pageQuery, c.req.query())), payerDto)));

  routes.post('/sources', async (c) => {
    const input = await jsonBody(c, NewSource);
    const source = await registerSource(db, {
      payerId: input.payer_id,
      title: input.title,
      sourceUrl: input.source_url,
      policySlug: input.policy_slug,
      market: input.market,
      checkIntervalHours: input.check_interval_hours,
      enabled: input.enabled,
    });
    return c.json(sourceDto(source), 201);
  });
  routes.get('/sources', async (c) => c.json(pageDto(await listSources(db, parse(pageQuery, c.req.query())), sourceDto)));
  routes.get('/sources/:id', async (c) => c.json(sourceDto(await getSource(db, parse(id, c.req.param('id'))))));
  routes.post('/sources/:id/check', async (c) => {
    const result = await checkSource(ctx, parse(id, c.req.param('id')));
    return c.json({
      watch_run: watchRunDto(result.run),
      version: result.version && versionDto(result.version),
      diff: result.diff && diffDto(result.diff),
    });
  });

  routes.get('/policies/:policyKey', async (c) => {
    const version = await getPublishedPolicy(db, c.req.param('policyKey'));
    return c.json(publishedDto(version, await getSource(db, version.sourceId)));
  });
  routes.get('/policies/:policyKey/versions', async (c) => {
    const page = await listPublishedVersions(db, c.req.param('policyKey'), parse(pageQuery, c.req.query()));
    return c.json(pageDto(page, versionDto));
  });
  routes.get('/policies/:policyKey/versions/:version', async (c) => {
    const number = parse(z.coerce.number().int().positive(), c.req.param('version'));
    const version = await getPublishedVersion(db, c.req.param('policyKey'), number);
    return c.json(publishedDto(version, await getSource(db, version.sourceId)));
  });

  routes.get('/versions', async (c) => {
    const query = parse(VersionFilter, c.req.query());
    const page = await listVersions(db, { status: query.status, policyKey: query.policy_key }, query);
    return c.json(pageDto(page, versionDto));
  });
  routes.get('/versions/:id', async (c) => {
    const version = await getVersion(db, parse(id, c.req.param('id')));
    return c.json({ ...versionDto(version), diff_id: (await diffForVersion(db, version.id)).id });
  });
  routes.post('/versions/:id/approve', async (c) => {
    const version = await approveVersion(
      db,
      { versionId: parse(id, c.req.param('id')), approvedBy: c.get('principal') },
      ctx.plugins,
    );
    return c.json(versionDto(version));
  });
  routes.post('/versions/:id/reject', async (c) => {
    const { reason } = await jsonBody(c, Rejection);
    const version = await rejectVersion(
      db,
      { versionId: parse(id, c.req.param('id')), rejectedBy: c.get('principal'), reason },
      ctx.plugins,
    );
    return c.json(versionDto(version));
  });

  routes.get('/diffs/:id', async (c) => c.json(diffDto(await getDiff(db, parse(id, c.req.param('id'))))));

  return routes;
}
