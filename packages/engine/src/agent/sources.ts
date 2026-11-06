import type { Db } from '@anumat/db';
import { AppError } from '@anumat/core';
import type { BlobStore } from '../storage/blob-store';
import type { AgentSources } from './tools';

export function databaseSources(db: Db | undefined, blobs: BlobStore): AgentSources {
  return {
    async markdown(documentId) {
      if (!db) {
        throw new AppError(
          'database_not_configured',
          'A database is not configured. Pass databaseUrl or db to createEngine to use the catalog, versioning, and approval workflow.',
        );
      }
      const document = await db.policyDocument.findUnique({
        where: { id: documentId },
        select: { markdownPath: true },
      });
      if (!document?.markdownPath) throw new AppError('not_found', `Document ${documentId} has no markdown`);
      return new TextDecoder().decode(await blobs.get(document.markdownPath));
    },
    async approvedExtraction(policyKey) {
      if (!db) return null;
      const version = await db.policyVersion.findFirst({
        where: { policyKey, status: 'approved' },
        orderBy: { version: 'desc' },
        select: { version: true, extractedJson: true },
      });
      return version ? { version: version.version ?? 0, extraction: version.extractedJson } : null;
    },
  };
}
