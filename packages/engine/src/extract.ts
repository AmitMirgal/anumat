import { randomUUID } from 'node:crypto';
import { AppError, MARKET_IDS } from '@anumat/core';
import type { Market } from '@anumat/markets';
import { createPolicyAgent } from './agent/policy-agent';
import type { AgentSources } from './agent/tools';
import { pdfToMarkdown, type Converter } from './convert/pdf-to-markdown';
import type { AppContext } from './context';

const PDF_MAGIC = '%PDF-';

export type ExtractInput = {
  pdf: Uint8Array;
  payer?: string;
  title?: string;
  market?: Market;
};

export type ExtractedPolicy = {
  extraction: unknown;
  model: string;
  converter: Converter;
  charsRead: number;
  sectionsRead: string[];
};

function asPdfBytes(pdf: Uint8Array): Uint8Array {
  if (!(pdf instanceof Uint8Array) || pdf.byteLength === 0) {
    throw new AppError('validation_failed', 'extract requires a non-empty PDF');
  }
  if (new TextDecoder().decode(pdf.subarray(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
    throw new AppError('not_a_pdf', 'extract requires a PDF document');
  }
  return pdf;
}

export async function extractFromPdf(ctx: AppContext, input: ExtractInput): Promise<ExtractedPolicy> {
  const pdf = asPdfBytes(input.pdf);
  const market = input.market ?? 'us';
  if (!(MARKET_IDS as readonly string[]).includes(market)) {
    throw new AppError('validation_failed', `market must be ${MARKET_IDS.join(' or ')}`);
  }
  const models = ctx.agents[market].models;
  const payer = input.payer?.trim() || 'Unknown payer';
  const title = input.title?.trim() || 'Untitled policy';
  const { markdown, converter } = await pdfToMarkdown(pdf, {
    apiKey: ctx.config.firecrawlApiKey,
    apiUrl: ctx.config.firecrawlApiUrl,
  });
  const documentId = randomUUID();
  const sources: AgentSources = {
    markdown: async (id) => {
      if (id !== documentId) throw new AppError('not_found', `Document ${id} is not part of this job`);
      return markdown;
    },
    approvedExtraction: async () => null,
  };
  const agent = await createPolicyAgent({ market, models, sources });
  const result = await agent.extractDocument({
    documentId,
    policyKey: 'local.extract',
    payer,
    title,
  });
  return {
    extraction: result.extraction,
    model: result.model,
    converter,
    charsRead: result.charsRead,
    sectionsRead: result.sectionsRead,
  };
}

export function pdfFromBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(Buffer.from(value, 'base64'));
  } catch {
    throw new AppError('validation_failed', 'extract pdf must be base64-encoded PDF bytes');
  }
}
