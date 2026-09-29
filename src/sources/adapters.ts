import { AppError } from '../errors';
import type { AdapterType } from '../generated/prisma/client';

export type { AdapterType };
export type FetchedArtifact = { bytes: Uint8Array; mime: string };

export interface SourceAdapter {
  fetchArtifact(source: { sourceUrl: string }): Promise<FetchedArtifact>;
}

const MAX_BYTES = 50 * 1024 * 1024;
const PDF_MAGIC = '%PDF-';

export const httpPdf: SourceAdapter = {
  async fetchArtifact({ sourceUrl }) {
    let response: Response;
    try {
      response = await fetch(sourceUrl, {
        headers: { accept: 'application/pdf', 'user-agent': 'AnumatPolicyWatcher/0.1' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError('fetch_failed', `Could not fetch ${sourceUrl}: ${String(error)}`, { url: sourceUrl });
    }
    if (!response.ok) {
      throw new AppError('fetch_failed', `${sourceUrl} returned HTTP ${response.status}`, {
        url: sourceUrl,
        status: response.status,
      });
    }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
      throw new AppError('fetch_failed', `${sourceUrl} is larger than ${MAX_BYTES} bytes`, { url: sourceUrl });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
      throw new AppError('not_a_pdf', `${sourceUrl} did not return a PDF`, {
        url: sourceUrl,
        content_type: response.headers.get('content-type'),
      });
    }
    return { bytes, mime: 'application/pdf' };
  },
};

export const adapters: Record<AdapterType, SourceAdapter> = { http_pdf: httpPdf };
