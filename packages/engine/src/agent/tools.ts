import { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { outline, readSections } from '../documents/outline';
import { extractSchemas, type Market } from '@anumat/markets';
import type { ModeId } from './policy-agent';

export type ToolName = 'get_policy_document' | 'save_triage' | 'save_extraction' | 'get_approved_version' | 'save_diff';

export type AgentSources = {
  markdown(documentId: string): Promise<string>;
  approvedExtraction(policyKey: string): Promise<{ version: number; extraction: unknown } | null>;
};

export const triageSchema = z.strictObject({
  is_prior_auth_policy: z
    .boolean()
    .describe('False for index pages, retired-policy notices, bulletins, and other documents without coverage rules'),
  section_ids: z
    .array(z.string().min(1))
    .max(12)
    .describe('Outline sections holding coverage criteria, codes, exclusions, documentation, and site of care'),
  reason: z.string().min(3).max(400),
});
export type Triage = z.infer<typeof triageSchema>;

export const reviewSchema = z.strictObject({
  verdict: z.enum(['consistent', 'needs_attention']),
  findings: z
    .array(z.strictObject({ field: z.string().min(1).max(60), note: z.string().min(3).max(600) }))
    .max(30)
    .describe('Changes the document does not support, or supports differently'),
});
export type Review = z.infer<typeof reviewSchema>;

const MAX_CHARS_PER_READ = 40_000;
const OUTLINE_DEPTH = 3;
const SCOPE_KEY = 'anumat.job';

export class JobScope {
  triage: Triage | undefined;
  extraction: unknown;
  summary: string | undefined;
  review: Review | undefined;
  charsRead = 0;
  sectionsRead: string[] = [];

  constructor(
    readonly mode: ModeId,
    readonly target: { documentId?: string; policyKey?: string; diffId?: string },
  ) {}
}

export function jobContext(scope: JobScope): RequestContext {
  return new RequestContext([[SCOPE_KEY, scope]]);
}

export function scopeOf(requestContext: { get(key: string): unknown }): JobScope {
  const scope = requestContext.get(SCOPE_KEY);
  if (!(scope instanceof JobScope)) throw new Error('Anumat tools run only inside a policy agent job');
  return scope;
}

const outsideJob = (kind: string, id: string) => ({ error: true, message: `${kind} ${id} is not part of this job` });

export function createPolicyTools(market: Market, sources: AgentSources) {
  const get_policy_document = createTool({
    id: 'get_policy_document',
    description:
      'Read a converted policy document by id. Without section_ids it returns the outline: section ids, levels, headings, and sizes in characters, three heading levels deep. With section_ids it returns those sections, each with all its subsections, up to 40,000 characters per call.',
    inputSchema: z.object({
      document_id: z.string(),
      section_ids: z.array(z.string()).min(1).max(12).optional(),
    }),
    execute: async ({ document_id, section_ids }, { requestContext }) => {
      const scope = scopeOf(requestContext);
      if (document_id !== scope.target.documentId) return outsideJob('Document', document_id);
      const markdown = await sources.markdown(document_id);
      const sections = outline(markdown);
      const topLevel = Math.min(...sections.map((section) => section.level || Number.POSITIVE_INFINITY));
      const result = section_ids
        ? { document_id, ...readSections(markdown, sections, section_ids, MAX_CHARS_PER_READ) }
        : {
            document_id,
            total_chars: markdown.length,
            sections: sections
              .filter((section) => section.level < topLevel + OUTLINE_DEPTH)
              .map(({ id, level, heading, start, end }) => ({ id, level, heading: heading.slice(0, 120), chars: end - start })),
          };
      if ('unknown_ids' in result) scope.sectionsRead.push(...result.sections.map((section) => section.id));
      scope.charsRead += JSON.stringify(result).length;
      return result;
    },
  });

  const save_triage = createTool({
    id: 'save_triage',
    description: 'Record whether the document is a prior-auth or medical coverage policy and which outline sections hold its rules. Call once.',
    inputSchema: z.object({ document_id: z.string(), triage: triageSchema }),
    execute: async ({ document_id, triage }, { requestContext }) => {
      const scope = scopeOf(requestContext);
      if (document_id !== scope.target.documentId) return outsideJob('Document', document_id);
      scope.triage = triage;
      return { saved: true };
    },
  });

  const save_extraction = createTool({
    id: 'save_extraction',
    description:
      'Save the structured prior-auth rules extracted from the document. Call once when complete. If it returns validation errors, fix the named fields and call it again.',
    inputSchema: z.object({ document_id: z.string(), extraction: extractSchemas[market] }),
    execute: async ({ document_id, extraction }, { requestContext }) => {
      const scope = scopeOf(requestContext);
      if (document_id !== scope.target.documentId) return outsideJob('Document', document_id);
      scope.extraction = extraction;
      return { saved: true };
    },
  });

  const get_approved_version = createTool({
    id: 'get_approved_version',
    description: 'Read the latest approved (published) rules for a policy key. Returns found: false when nothing is published yet.',
    inputSchema: z.object({ policy_key: z.string() }),
    execute: async ({ policy_key }, { requestContext }) => {
      const scope = scopeOf(requestContext);
      if (policy_key !== scope.target.policyKey) return outsideJob('Policy', policy_key);
      const approved = await sources.approvedExtraction(policy_key);
      const result = approved ? { found: true, version: approved.version, extraction: approved.extraction } : { found: false };
      scope.charsRead += JSON.stringify(result).length;
      return result;
    },
  });

  const save_diff = createTool({
    id: 'save_diff',
    description:
      'Attach reviewer notes to a change set. Diff mode sends summary. Review mode sends review. Call once.',
    inputSchema: z.object({
      diff_id: z.string(),
      summary: z.string().min(10).max(1500).optional(),
      review: reviewSchema.optional(),
    }),
    execute: async ({ diff_id, summary, review }, { requestContext }) => {
      const scope = scopeOf(requestContext);
      if (diff_id !== scope.target.diffId) return outsideJob('Diff', diff_id);
      if (summary) scope.summary = summary;
      if (review) scope.review = review;
      return { saved: true };
    },
  });

  return { get_policy_document, save_triage, save_extraction, get_approved_version, save_diff } satisfies Record<
    ToolName,
    unknown
  >;
}
