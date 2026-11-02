# @anumat/js

Typed TypeScript client for Anumat. It calls tRPC at `{baseUrl}/trpc`.

```bash
npm install @anumat/js
```

```typescript
import { createAnumatClient } from '@anumat/js';

const anumat = createAnumatClient({
  baseUrl: 'http://127.0.0.1:4471',
  apiKey: 'your-api-key',
});
const page = await anumat.payers.list.query({ limit: 20 });
```

`baseUrl` must be an `http` or `https` URL. `apiKey` must contain a non-blank value. `createAnumatClient` throws `AnumatClientError` with code `validation_failed` when either value is wrong. The client sends `Authorization: Bearer <apiKey>`.

The client follows the tRPC router. These calls cover the REST resources.

- `payers.create`, `payers.list`
- `sources.create`, `sources.list`, `sources.get`, `sources.check`
- `policies.get`, `policies.versions`, `policies.version`
- `versions.list`, `versions.get`, `versions.approve`, `versions.reject`
- `diffs.get`

The published package ships ESM from `dist/index.js` and CJS from `dist/index.cjs`, with a separate type file for each. The tarball includes `LICENSE` and this README, and it omits source maps, scripts, and dev dependencies.

The server is a separate process. See the repository [README](../../README.md) for how to run it.

`@anumat/js` is Apache-2.0. The copyright line in `LICENSE` is `Copyright 2026 AmitMirgal`. Version bumps go through Changesets.
