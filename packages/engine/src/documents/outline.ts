export type Section = { id: string; level: number; heading: string; start: number; end: number };

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function slugify(heading: string, used: Map<string, number>): string {
  const base =
    heading
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section';
  const count = (used.get(base) ?? 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

export function outline(markdown: string): Section[] {
  const headings: { level: number; heading: string; start: number }[] = [];
  let offset = 0;
  for (const line of markdown.split('\n')) {
    const match = HEADING.exec(line);
    const heading = match?.[2]?.replace(/<[^>]+>/g, '').trim();
    if (match?.[1] && heading) headings.push({ level: match[1].length, heading, start: offset });
    offset += line.length + 1;
  }

  const sections: Section[] = [];
  const firstHeading = headings[0]?.start ?? markdown.length;
  if (markdown.slice(0, firstHeading).trim()) {
    sections.push({ id: 'preamble', level: 0, heading: 'Preamble', start: 0, end: firstHeading });
  }
  const used = new Map<string, number>();
  headings.forEach((heading, index) => {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    sections.push({ id: slugify(heading.heading, used), ...heading, end: next?.start ?? markdown.length });
  });
  return sections;
}

export function readSections(markdown: string, sections: Section[], ids: string[], maxChars: number) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const requested = [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
  const insideAnother = (section: Section) =>
    requested.some(
      (parent) => parent.level < section.level && parent.start <= section.start && section.end <= parent.end,
    );
  let remaining = maxChars;
  return {
    sections: requested
      .filter((section) => !insideAnother(section))
      .map((section) => {
        const text = markdown.slice(section.start, section.end);
        const kept = text.slice(0, Math.max(0, remaining));
        remaining -= kept.length;
        return { id: section.id, heading: section.heading, text: kept, truncated: kept.length < text.length };
      }),
    unknown_ids: ids.filter((id) => !byId.has(id)),
  };
}
