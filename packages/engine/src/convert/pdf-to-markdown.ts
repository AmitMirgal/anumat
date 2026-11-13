import { AppError } from '@anumat/core';
import { procedureCodesInPdf, procedureCodesInText } from '../documents/code-list';

async function loadAnydoc() {
  return import('@firecrawl/anydoc');
}

export const converters = ['anydoc', 'firecrawl-parse'] as const;
export type Converter = (typeof converters)[number];
export type OcrOptions = { apiKey: string | undefined; apiUrl: string | undefined };

export function conversionQualityError(markdown: string, pdf: Uint8Array): AppError | undefined {
  const trimmed = markdown.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return new AppError(
      'conversion_failed',
      'PDF conversion produced no text. The converter returned an empty document rather than a policy.',
      { markdown_chars: markdown.length },
    );
  }
  const pdfCodes = procedureCodesInPdf(pdf);
  const kept = new Set(procedureCodesInText(markdown));
  const dropped = pdfCodes.filter((code) => !kept.has(code));
  if (pdfCodes.length >= 2 && dropped.length === pdfCodes.length) {
    return new AppError(
      'conversion_failed',
      `PDF conversion dropped procedure codes present in the document (${pdfCodes.slice(0, 8).join(', ')}). The converter returned ${markdown.length} characters of markdown.`,
      { markdown_chars: markdown.length, dropped_codes: pdfCodes.slice(0, 20) },
    );
  }
  return undefined;
}

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
    const { toMarkdownBytes } = await loadAnydoc();
    const markdown = await toMarkdownBytes(bytes);
    const quality = conversionQualityError(markdown, bytes);
    if (quality) throw quality;
    return { markdown, converter: 'anydoc' };
  } catch (error) {
    if (error instanceof AppError) throw error;
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
    const { toMarkdownBytes } = await loadAnydoc();
    const markdown = await toMarkdownBytes(bytes, null, { ocr: 'hosted', apiKey: ocr.apiKey, apiUrl: ocr.apiUrl });
    const quality = conversionQualityError(markdown, bytes);
    if (quality) throw quality;
    return { markdown, converter: 'firecrawl-parse' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw conversionFailed(error);
  }
}
