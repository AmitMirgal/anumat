# @anumat/api

The Hono app. It mounts the existing `/v1` routes, tRPC at `/trpc`, and REST at `/api/v1`.

`createApp({ plugins })` returns the app. With no argument, `createApp()` still answers `GET /health`. Route handlers call `@anumat/engine`. This package does not own rule extraction.
