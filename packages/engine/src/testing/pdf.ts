function assemble(objects: string[]): Uint8Array {
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const stream = (content: string, dictionary = '') =>
  `<< ${dictionary}/Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;

const escape = (line: string) => line.replace(/[\\()]/g, (char) => `\\${char}`);

export function textPdf(lines: string[]): Uint8Array {
  const content = ['BT', '/F1 12 Tf', '14 TL', '72 720 Td', ...lines.map((line) => `(${escape(line)}) Tj T*`), 'ET'];
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream(content.join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

export type TablePdfRow = { policy: string; code: string };

/** Two-column payer code-list layout: policy name at x=72, CPT at x=360. No markdown headings. */
export function twoColumnCodeListPdf(
  title: string,
  rows: TablePdfRow[],
  options?: { preamble?: string[] },
): Uint8Array {
  const left = 72;
  const right = 360;
  const write = (x: number, y: number, text: string) => `${x} ${y} Td (${escape(text)}) Tj`;
  const ops: string[] = ['BT', '/F1 12 Tf'];
  let y = 740;
  if (title) {
    ops.push(write(left, y, title));
    y -= 22;
  }
  for (const line of options?.preamble ?? []) {
    ops.push('1 0 0 1 0 0 Tm');
    ops.push(write(left, y, line));
    y -= 16;
  }
  ops.push('1 0 0 1 0 0 Tm');
  ops.push(write(left, y, 'Policy Name'));
  ops.push('1 0 0 1 0 0 Tm');
  ops.push(write(right, y, 'CPT Code'));
  y -= 18;
  for (const row of rows) {
    ops.push('1 0 0 1 0 0 Tm');
    ops.push(write(left, y, row.policy));
    ops.push('1 0 0 1 0 0 Tm');
    ops.push(write(right, y, row.code));
    y -= 16;
  }
  ops.push('ET');
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream(ops.join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

export const PRIOR_AUTH_CODE_LIST_ROWS: TablePdfRow[] = [
  { policy: 'Bariatric Surgery', code: '43644' },
  { policy: 'Bariatric Surgery', code: '43645' },
  { policy: 'Bariatric Surgery', code: '43775' },
  { policy: 'Obstructive Sleep Apnea Treatment', code: '95810' },
  { policy: 'Obstructive Sleep Apnea Treatment', code: '95811' },
];

export function priorAuthCodeListPdf(): Uint8Array {
  return twoColumnCodeListPdf('Commercial Prior Authorization Procedure Code List', PRIOR_AUTH_CODE_LIST_ROWS, {
    preamble: ['Effective January 1, 2026. Services on this list require prior authorization.'],
  });
}

/** Same table without a title heading, so conversion lands in a single preamble section. */
export function headinglessPriorAuthCodeListPdf(): Uint8Array {
  return twoColumnCodeListPdf('', PRIOR_AUTH_CODE_LIST_ROWS);
}

export function imageOnlyPdf(): Uint8Array {
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    stream('q 100 0 0 100 72 600 cm /Im1 Do Q'),
    stream(
      'ff00ff00ff00ff00ff00ff00>',
      '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode ',
    ),
  ]);
}
