import type { Db } from '@anumat/db';
import { AppError } from '@anumat/core';
import type { BlobStore } from '../storage/blob-store';
import type { AgentSources } from './tools';

export function databaseSources(db: Db, blobs: BlobStore): AgentSources {
  return {
    async markdown(documentId) {
      const document = await db.policyDocument.findUnique({
        where: { id: documentId },
        select: { markdownPath: true },
      });
      if (!document?.markdownPath) throw new AppError('not_found', `Document ${documentId} has no markdown`);
      return new TextDecoder().decode(await blobs.get(document.markdownPath));
    },
    async approvedExtraction(policyKey) {
      const version = await db.policyVersion.findFirst({
        where: { policyKey, status: 'approved' },
        orderBy: { version: 'desc' },
        select: { version: true, extractedJson: true },
      });
      return version ? { version: version.version ?? 0, extraction: version.extractedJson } : null;
    },
  };
}
