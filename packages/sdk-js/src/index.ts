import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@anumat/contract';

export class AnumatClientError extends Error {
  readonly code = 'validation_failed' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AnumatClientError';
  }
}

export function createAnumatClient(options: { baseUrl: string; apiKey: string }) {
  const baseUrl = httpBaseUrl(options.baseUrl);
  const apiKey = requiredApiKey(options.apiKey);
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
        headers() {
          return { authorization: `Bearer ${apiKey}` };
        },
      }),
    ],
  });
}

function httpBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AnumatClientError('baseUrl must be an http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AnumatClientError('baseUrl must be an http(s) URL');
  }
  return baseUrl.replace(/\/$/, '');
}

function requiredApiKey(apiKey: string): string {
  if (apiKey.trim() === '') throw new AnumatClientError('apiKey must be a non-empty string');
  return apiKey;
}
