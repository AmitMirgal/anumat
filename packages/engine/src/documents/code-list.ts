import { outline } from './outline';

const CPT = /\b\d{4}[0-9FTU]\b/g;
const HCPCS = /\b[A-V]\d{4}\b/g;
const TABLE_DIVIDER = /\|[\t :\-]*---[\t :\-]*\|/;
const NARRATIVE_POLICY_HEADING = /coverage rationale|medical necessity|indications|clinical (criteria|evidence)|documentation requirements|site of care/i;
const PDF_STRING = /\(([^)]{3,120})\)/g;

export function hasMarkdownTable(text: string): boolean {
  return TABLE_DIVIDER.test(text) && /\|.+\|/.test(text);
}

export function procedureCodesInText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(CPT)) {
    if (match[0]) found.add(match[0]);
  }
  for (const match of text.matchAll(HCPCS)) {
    if (match[0]) found.add(match[0]);
  }
  return [...found];
}

export function procedureCodesInPdf(bytes: Uint8Array): string[] {
  const text = new TextDecoder('latin1').decode(bytes);
  const found = new Set<string>();
  for (const match of text.matchAll(PDF_STRING)) {
    if (!match[1]) continue;
    for (const code of procedureCodesInText(match[1])) found.add(code);
  }
  return [...found];
}

export function isProcedureCodeTable(text: string): boolean {
  return hasMarkdownTable(text) && procedureCodesInText(text).length > 0;
}

export function procedureCodeTableSectionIds(markdown: string): string[] {
  return outline(markdown)
    .filter((section) => isProcedureCodeTable(markdown.slice(section.start, section.end)))
    .map((section) => section.id)
    .slice(0, 12);
}

export function isCodeListDocument(markdown: string): boolean {
  if (procedureCodeTableSectionIds(markdown).length === 0) return false;
  return !outline(markdown).some((section) => NARRATIVE_POLICY_HEADING.test(section.heading));
}

export function recoverCodeListTriage<T extends { is_prior_auth_policy: boolean; section_ids: string[]; reason: string }>(
  markdown: string,
  triage: T,
): T {
  if (!isCodeListDocument(markdown)) return triage;
  const tableSections = procedureCodeTableSectionIds(markdown);
  if (tableSections.length === 0) return triage;
  const sectionIds = [...new Set([...triage.section_ids, ...tableSections])].slice(0, 12);
  if (triage.is_prior_auth_policy && triage.section_ids.length > 0) return triage;
  return {
    ...triage,
    is_prior_auth_policy: true,
    section_ids: sectionIds,
    reason: triage.is_prior_auth_policy
      ? triage.reason
      : 'Document contains a procedure-code table; treating it as a prior-auth policy.',
  };
}
