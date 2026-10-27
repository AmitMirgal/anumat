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

export function textPdf(lines: string[]): Uint8Array {
  const escape = (line: string) => line.replace(/[\\()]/g, (char) => `\\${char}`);
  const content = ['BT', '/F1 12 Tf', '14 TL', '72 720 Td', ...lines.map((line) => `(${escape(line)}) Tj T*`), 'ET'];
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream(content.join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
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
