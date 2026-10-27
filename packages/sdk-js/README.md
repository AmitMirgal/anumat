# @anumat/sdk

Typed TypeScript client for Anumat. It calls tRPC at `{baseUrl}/trpc`.

```bash
npm i @anumat/sdk
```

```typescript
import { createAnumatClient } from '@anumat/sdk';

const anumat = createAnumatClient({
  baseUrl: 'http://127.0.0.1:4471',
  apiKey: 'your-api-key',
});
const page = await anumat.payers.list.query({ limit: 20 });
```

The server is a separate process. See the repository [README](../../README.md) for how to run it.

`@anumat/sdk` is Apache-2.0. Version bumps go through Changesets. This package is not published by the restructure that added it.
