import { generateOpenApiDocument } from 'trpc-to-openapi';
import { appRouter } from './router';

export function openApiDocument(baseUrl = 'http://127.0.0.1:4471/api/v1') {
  return generateOpenApiDocument(appRouter, {
    title: 'Anumat',
    description: 'Insurance policy documents in, structured coverage rules out.',
    version: '0.1.0',
    baseUrl,
  });
}
