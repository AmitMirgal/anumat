import { toMarkdownBytes } from '@firecrawl/anydoc';
import { AppError } from '../errors';

export const converters = ['anydoc', 'firecrawl-parse'] as const;
export type Converter = (typeof converters)[number];
export type OcrOptions = { apiKey: string | undefined; apiUrl: string | undefined };

function anydocCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function ocrPages(error: unknown): number[] {
  return error instanceof Error && 'pages' in error && Array.isArray(error.pages) ? error.pages : [];
}

function conversionFailed(error: unknown): AppError {
  const code = anydocCode(error) ?? 'unknown';
  const message = error instanceof Error ? error.message : String(error);
  return new AppError('conversion_failed', `anydoc could not convert the PDF (${code}): ${message}`, {
    anydoc_code: code,
  });
}

export async function pdfToMarkdown(
  bytes: Uint8Array,
  ocr: OcrOptions,
): Promise<{ markdown: string; converter: Converter }> {
  try {
    return { markdown: await toMarkdownBytes(bytes), converter: 'anydoc' };
  } catch (error) {
    if (anydocCode(error) !== 'needsOcr') throw conversionFailed(error);
    if (!ocr.apiKey) {
      const pages = ocrPages(error);
      throw new AppError(
        'ocr_not_configured',
        `PDF pages ${pages.join(', ')} are scanned and need OCR. Set FIRECRAWL_API_KEY to convert them with Firecrawl Parse.`,
        { pages },
      );
    }
  }
  try {
    const markdown = await toMarkdownBytes(bytes, null, { ocr: 'hosted', apiKey: ocr.apiKey, apiUrl: ocr.apiUrl });
    return { markdown, converter: 'firecrawl-parse' };
  } catch (error) {
    throw conversionFailed(error);
  }
}
