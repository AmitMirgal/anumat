# @anumat/engine

`@anumat/engine` turns payer policy PDFs into structured coverage rules. With Postgres it also stores a versioned catalog and an approval workflow. Without a database it still extracts rules so you can store them yourself. It does not check individual patients.

## Install the package

Install `@anumat/engine` with npm. The package requires Node.js 24 or newer.

```bash
npm install @anumat/engine
```

Cloud object storage is optional. Install a client only for the backend you use: `@aws-sdk/client-s3` for S3, `@google-cloud/storage` for GCS, or `@supabase/supabase-js` for Supabase Storage. Local disk needs no extra package.

## Extract without a database

```ts
import { closeContext, createEngine, extract } from '@anumat/engine';
import { readFile } from 'node:fs/promises';

const engine = await createEngine({
  llm: { strong: 'anthropic/claude-sonnet-4-5', cheap: 'anthropic/claude-haiku-4-5' },
});
const pdf = new Uint8Array(await readFile('bariatric-surgery.pdf'));
const result = await extract(engine, {
  pdf,
  payer: 'UnitedHealthcare',
  title: 'Bariatric Surgery',
});
await closeContext(engine);
```

`result.extraction` is the structured US coverage object. Store it in your own database. Catalog, versioning, and approval methods throw `database_not_configured` until you pass `databaseUrl` or `db`.

## Apply the migrations

`anumat migrate` applies the SQL migrations shipped with this package. It records them in `_prisma_migrations`. A database already updated with `prisma migrate deploy` stays as it is. A second run also leaves an up-to-date database unchanged.

```bash
npx anumat migrate --db postgres://USER:PASSWORD@HOST:5432/DATABASE
```

Pass the database URL with `--db`. The command does not read `DATABASE_URL` from the environment.

## Call createEngine

```ts
import { closeContext, createEngine } from '@anumat/engine';

const engine = await createEngine({
  databaseUrl: 'postgres://USER:PASSWORD@HOST:5432/DATABASE',
});

await closeContext(engine);
```

`databaseUrl` and `db` are optional. Pass at most one of them. `databaseUrl` must be a `postgres://` or `postgresql://` URL of at most 4096 characters. `createEngine` opens that client and checks the connection before it returns. `db` reuses a client you already opened and must provide `$queryRaw` and `$disconnect`. `closeContext` disconnects a client that `createEngine` opened. It leaves a passed `db` open. Unknown options are rejected. `null` is rejected for `storage`, `llm`, and `firecrawl`.

`storage`, `llm`, and `firecrawl` are optional. `createEngine` does not read them from the environment.

For local files, pass `storage` as `{ kind: 'local', dataDir }`. The default directory is `./data/policies`. For object storage, pass one of:

```ts
{
  kind: 's3',
  region: 'us-east-1',
  bucket: 'policies',
  accessKeyId: 'AKIA...',
  secretAccessKey: '...',
  endpoint: 'https://s3.example', // optional
}
{
  kind: 'gcs',
  bucket: 'anumat-policies',
  projectId: 'my-project', // optional
  keyFilename: '/path/to/key.json', // optional
}
{
  kind: 'supabase',
  url: 'https://PROJECT.supabase.co',
  apiKey: 'service-role-key',
  bucket: 'policies',
}
```

S3 `endpoint` is the custom URL for an S3-compatible store, including the GCS XML API and Supabase's S3 protocol. Prefer `kind: 'gcs'` or `kind: 'supabase'` when you want the native SDK.

The HTTP API reads `ANUMAT_STORAGE=local|s3|gcs|supabase` and the matching `ANUMAT_DATA_DIR`, `ANUMAT_S3_*`, `ANUMAT_GCS_*`, or `ANUMAT_SUPABASE_*` variables. `createEngine` does not. The HTTP API requires `DATABASE_URL`.

Pass `llm` as `{ strong, cheap }` with two `provider/model` ids when extract or a check should call a model. Omit `llm` until a call needs one.

Pass `firecrawl` as `{ apiKey, apiUrl }` when a scanned PDF needs hosted OCR. Text PDFs do not need it.

## Call a policy method

Each policy function takes the engine, then one input object. Returned fields use camelCase. `slugify` turns a title into the slug those inputs expect.

```ts
import { listPayers, registerPayer, slugify } from '@anumat/engine';

const payer = await registerPayer(engine, {
  name: 'Example Health',
  slug: slugify('Example Health'),
  market: 'us',
});
const page = await listPayers(engine, { limit: 20 });
```

`dueSources` and `checkDueSources` take an empty object when you omit the second argument.

The package exports these functions.

- `extract`
- `registerPayer`, `getPayer`, `findPayerBySlug`, `listPayers`
- `registerSource`, `getSource`, `findSourceByPolicyKey`, `listSources`
- `checkSource`, `dueSources`, `checkDueSources`
- `proposeVersion`, `approveVersion`, `rejectVersion`
- `getPublishedPolicy`, `getPublishedVersion`, `listPublishedVersions`
- `getVersion`, `listVersions`, `getDiff`, `diffForVersion`, `saveDiffNotes`
- `slugify`

Invalid input throws `AppError` with code `validation_failed`. The Python package `anumat-engine` exposes the same operations as snake_case methods on the engine object.

## Breaking changes

The published package no longer depends on `@aws-sdk/client-s3`. S3 users must install that client. GCS and Supabase Storage use `@google-cloud/storage` and `@supabase/supabase-js` the same way.

`AppContext.db` is `Db | undefined` when no `databaseUrl` or `db` is passed. Call `requireDatabase(ctx)` instead of reading `ctx.db` as if a client is always there. Catalog methods already do that and throw `database_not_configured`.

`createEngine()` with no options is valid. `null` is still rejected.
