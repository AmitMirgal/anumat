import { generateOpenApiDocument } from 'trpc-to-openapi';
import { appRouter } from './router';

const createdPaths = new Set(['/payers', '/sources']);
const conflictPaths = new Set(['/payers', '/sources', '/versions/{id}/approve', '/versions/{id}/reject']);
const emptyJsonBodyPaths = new Set(['/sources/{id}/check', '/versions/{id}/approve']);

type Document = ReturnType<typeof generateOpenApiDocument>;
type ResponseObject = { description?: string; content?: unknown; headers?: unknown };
type JsonOperation = {
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, ResponseObject>;
};

export function openApiDocument(baseUrl = 'http://127.0.0.1:4471/api/v1') {
  const document = generateOpenApiDocument(appRouter, {
    title: 'Anumat',
    description: 'Insurance policy documents in, structured coverage rules out.',
    version: '0.1.0',
    baseUrl,
  });
  return withStatusCodes(document);
}

function withStatusCodes(document: Document): Document {
  const paths = document.paths ?? {};
  for (const [path, item] of Object.entries(paths)) {
    const post = item?.post;
    const responses = post?.responses;
    if (!post || !responses) continue;
    if (createdPaths.has(path)) {
      const ok = responses['200'] as ResponseObject | undefined;
      if (ok) {
        responses['201'] = { ...ok, description: 'Created' };
        delete responses['200'];
      }
    }
    if (conflictPaths.has(path)) {
      const badRequest = responses['400'] as ResponseObject | undefined;
      responses['409'] = badRequest
        ? { ...badRequest, description: 'Conflict' }
        : { description: 'Conflict' };
    }
    if (emptyJsonBodyPaths.has(path)) {
      const operation = post as JsonOperation;
      operation.requestBody = {
        required: true,
        description: 'Send an empty JSON object.',
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: false },
          },
        },
      };
    }
  }
  return document;
}
