import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { pdfToMarkdown } from '../src/convert/pdf-to-markdown';
import { outline, readSections } from '../src/documents/outline';
import { AppError } from '@anumat/core';
import { httpPdf } from '../src/sources/adapters';
import { startServer } from '../src/testing/http';
import { imageOnlyPdf, textPdf } from '../src/testing/pdf';

const markdown = [
  'UnitedHealthcare Medical Policy',
  '# Bariatric Surgery',
  'Policy Number: 2025T0362KK',
  '# Coverage Rationale',
  '## <u>Adults</u>',
  'BMI of 40 or greater.',
  '## Adolescents',
  'BMI of 35 or greater.',
  '# Applicable Codes',
  '43644 Laparoscopic gastric bypass',
  '# Coverage Rationale',
  'Repeated heading.',
].join('\n');

test('outline splits markdown into nested sections with unique ids', () => {
  expect(outline(markdown).map(({ id, level, heading, start, end }) => ({ id, level, heading, text: markdown.slice(start, end) }))).toEqual([
    { id: 'preamble', level: 0, heading: 'Preamble', text: 'UnitedHealthcare Medical Policy\n' },
    { id: 'bariatric-surgery', level: 1, heading: 'Bariatric Surgery', text: '# Bariatric Surgery\nPolicy Number: 2025T0362KK\n' },
    {
      id: 'coverage-rationale',
      level: 1,
      heading: 'Coverage Rationale',
      text: '# Coverage Rationale\n## <u>Adults</u>\nBMI of 40 or greater.\n## Adolescents\nBMI of 35 or greater.\n',
    },
    { id: 'adults', level: 2, heading: 'Adults', text: '## <u>Adults</u>\nBMI of 40 or greater.\n' },
    { id: 'adolescents', level: 2, heading: 'Adolescents', text: '## Adolescents\nBMI of 35 or greater.\n' },
    { id: 'applicable-codes', level: 1, heading: 'Applicable Codes', text: '# Applicable Codes\n43644 Laparoscopic gastric bypass\n' },
    { id: 'coverage-rationale-2', level: 1, heading: 'Coverage Rationale', text: '# Coverage Rationale\nRepeated heading.' },
  ]);
});

test('readSections skips children of requested parents, reports unknown ids, and truncates at the budget', () => {
  const sections = outline(markdown);
  expect(readSections(markdown, sections, ['adults', 'coverage-rationale', 'missing'], 1_000)).toEqual({
    sections: [
      {
        id: 'coverage-rationale',
        heading: 'Coverage Rationale',
        text: '# Coverage Rationale\n## <u>Adults</u>\nBMI of 40 or greater.\n## Adolescents\nBMI of 35 or greater.\n',
        truncated: false,
      },
    ],
    unknown_ids: ['missing'],
  });
  expect(readSections(markdown, sections, ['applicable-codes', 'adults'], 25).sections).toEqual([
    { id: 'applicable-codes', heading: 'Applicable Codes', text: '# Applicable Codes\n43644 ', truncated: true },
    { id: 'adults', heading: 'Adults', text: '', truncated: true },
  ]);
});

test('anydoc converts a text PDF', async () => {
  const result = await pdfToMarkdown(textPdf(['Bariatric Surgery', 'CPT 43644 requires review.']), {
    apiKey: undefined,
    apiUrl: undefined,
  });
  expect(result).toEqual({ markdown: 'Bariatric Surgery CPT 43644 requires review.\n', converter: 'anydoc' });
});

test('a scanned PDF fails with a clear error when FIRECRAWL_API_KEY is missing', async () => {
  const error = await pdfToMarkdown(imageOnlyPdf(), { apiKey: undefined, apiUrl: undefined }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    code: 'ocr_not_configured',
    message: 'PDF pages 1 are scanned and need OCR. Set FIRECRAWL_API_KEY to convert them with Firecrawl Parse.',
    details: { pages: [1] },
  });
});

test('a scanned PDF goes to Firecrawl Parse when a key is set', async () => {
  const requests: { path: string | undefined; auth: string | undefined }[] = [];
  const parse = await startServer((req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, data: { markdown: '# Scanned policy\nCPT 43644' } }));
  });
  try {
    const result = await pdfToMarkdown(imageOnlyPdf(), { apiKey: 'fc-test-key', apiUrl: parse.url });
    expect(result).toEqual({ markdown: '# Scanned policy\nCPT 43644\n', converter: 'firecrawl-parse' });
    expect(requests).toEqual([{ path: '/v2/parse', auth: 'Bearer fc-test-key' }]);
  } finally {
    await parse.close();
  }
});

let payer: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  payer = await startServer((req, res) => {
    if (req.url === '/policy.pdf') return res.end(Buffer.from(textPdf(['Policy'])));
    if (req.url === '/page.html') {
      res.setHeader('content-type', 'text/html');
      return res.end('<html>Moved</html>');
    }
    res.statusCode = 404;
    res.end();
  });
});
afterAll(() => payer.close());

test('http_pdf fetches PDF bytes and rejects HTML and missing pages', async () => {
  const fetched = await httpPdf.fetchArtifact({ sourceUrl: `${payer.url}/policy.pdf` });
  expect({ mime: fetched.mime, magic: new TextDecoder().decode(fetched.bytes.subarray(0, 5)) }).toEqual({
    mime: 'application/pdf',
    magic: '%PDF-',
  });
  await expect(httpPdf.fetchArtifact({ sourceUrl: `${payer.url}/page.html` })).rejects.toMatchObject({
    code: 'not_a_pdf',
    details: { content_type: 'text/html' },
  });
  await expect(httpPdf.fetchArtifact({ sourceUrl: `${payer.url}/gone.pdf` })).rejects.toMatchObject({
    code: 'fetch_failed',
    details: { status: 404 },
  });
});

test('http_pdf downloads the PDF when the server sends the body only for Connection: close', async () => {
  const pdf = Buffer.from('%PDF-1.1\n');
  const server = createHttpServer((req, res) => {
    req.on('error', () => undefined);
    res.on('error', () => undefined);
    if (req.headers.connection === 'close') {
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(pdf.length),
        connection: 'close',
      });
      res.end(pdf);
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': String(pdf.length),
      connection: 'keep-alive',
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const fetched = await httpPdf.fetchArtifact({ sourceUrl: `http://127.0.0.1:${port}/policy.pdf` });
    expect(fetched.mime).toBe('application/pdf');
    expect(new TextDecoder().decode(fetched.bytes)).toBe('%PDF-1.1\n');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 4_000);

test('http_pdf returns the PDF when another address family accepts and then sends nothing', async () => {
  const pdf = Buffer.from('%PDF-1.1\n');
  const good = createHttpServer((_req, res) => {
    res.setHeader('content-type', 'application/pdf');
    res.end(pdf);
  });
  await new Promise<void>((resolve) => good.listen(0, '127.0.0.1', resolve));
  const { port } = good.address() as AddressInfo;
  const stall = createTcpServer((socket) => {
    socket.on('error', () => undefined);
    socket.on('data', () => {
      socket.write(
        'HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 947613\r\nConnection: keep-alive\r\n\r\n',
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    stall.once('error', reject);
    stall.listen(port, '::1', () => resolve());
  });
  try {
    const fetched = await httpPdf.fetchArtifact({ sourceUrl: `http://localhost:${port}/policy.pdf` });
    expect(fetched.mime).toBe('application/pdf');
    expect(new TextDecoder().decode(fetched.bytes)).toBe('%PDF-1.1\n');
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => good.close(() => resolve())),
      new Promise<void>((resolve) => stall.close(() => resolve())),
    ]);
  }
}, 4_000);
