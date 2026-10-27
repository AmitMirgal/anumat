import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@anumat/contract';

export function createAnumatClient(options: { baseUrl: string; apiKey: string }) {
  const base = options.baseUrl.replace(/\/$/, '');
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${base}/trpc`,
        headers() {
          return { authorization: `Bearer ${options.apiKey}` };
        },
      }),
    ],
  });
}
