# @anumat/api

The Hono app. It mounts the existing `/v1` routes, tRPC at `/trpc`, and REST at `/api/v1`.

The HTTP API requires `DATABASE_URL`. Policy files default to local disk (`ANUMAT_STORAGE=local`). Set `ANUMAT_STORAGE` to `s3`, `gcs`, or `supabase` and the matching `ANUMAT_S3_*`, `ANUMAT_GCS_*`, or `ANUMAT_SUPABASE_*` variables to use object storage.

`createApp({ plugins })` returns the app. With no argument, `createApp()` still answers `GET /health`. Route handlers call `@anumat/engine`. This package does not own rule extraction. The embedded engine can extract rules without Postgres; this server cannot start a catalog without a database.
