# @anumat/engine

`@anumat/engine` checks payer policy documents and stores proposed versions in Postgres.

## Install the package

Install `@anumat/engine` with npm. The package requires Node.js 24 or newer.

```bash
npm install @anumat/engine
```

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

Pass `databaseUrl` or `db`, and only one of them. `databaseUrl` must be a `postgres://` or `postgresql://` URL of at most 4096 characters. `createEngine` opens that client and checks the connection before it returns. `db` reuses a client you already opened and must provide `$queryRaw` and `$disconnect`. `closeContext` disconnects a client that `createEngine` opened. It leaves a passed `db` open. Unknown options are rejected. `null` is rejected for `storage`, `llm`, and `firecrawl`.

`storage`, `llm`, and `firecrawl` are optional. `createEngine` does not read them from the environment.

For local files, pass `storage` as `{ kind: 'local', dataDir }`. The default directory is `./data/policies`. For object storage, pass `storage` as `{ kind: 's3', region, bucket, accessKeyId, secretAccessKey }`. Pass `endpoint` for a custom S3-compatible URL.

Pass `llm` as `{ strong, cheap }` with two `provider/model` ids when a check should call a model. Omit `llm` until a check needs one.

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

- `registerPayer`, `getPayer`, `findPayerBySlug`, `listPayers`
- `registerSource`, `getSource`, `findSourceByPolicyKey`, `listSources`
- `checkSource`, `dueSources`, `checkDueSources`
- `proposeVersion`, `approveVersion`, `rejectVersion`
- `getPublishedPolicy`, `getPublishedVersion`, `listPublishedVersions`
- `getVersion`, `listVersions`, `getDiff`, `diffForVersion`, `saveDiffNotes`
- `slugify`

Invalid input throws `AppError` with code `validation_failed`. The Python package `anumat-engine` exposes the same operations as snake_case methods on the engine object.
