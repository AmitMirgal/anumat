import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { policyDocuments, policyVersions } from '../db/schema';
import { AppError } from '../errors';
import type { BlobStore } from '../storage/blob-store';
import type { AgentSources } from './tools';

export function databaseSources(db: Db, blobs: BlobStore): AgentSources {
  return {
    async markdown(documentId) {
      const [document] = await db
        .select({ path: policyDocuments.markdownPath })
        .from(policyDocuments)
        .where(eq(policyDocuments.id, documentId));
      if (!document?.path) throw new AppError('not_found', `Document ${documentId} has no markdown`);
      return new TextDecoder().decode(await blobs.get(document.path));
    },
    async approvedExtraction(policyKey) {
      const [version] = await db
        .select({ version: policyVersions.version, extraction: policyVersions.extractedJson })
        .from(policyVersions)
        .where(and(eq(policyVersions.policyKey, policyKey), eq(policyVersions.status, 'approved')))
        .orderBy(desc(policyVersions.version))
        .limit(1);
      return version ? { version: version.version ?? 0, extraction: version.extraction } : null;
    },
  };
}
