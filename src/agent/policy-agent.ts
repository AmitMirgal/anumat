import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { AgentController } from '@mastra/core/agent-controller';
import type { MastraModelConfig } from '@mastra/core/llm';
import { AppError } from '../errors';
import type { Change, Market } from '../markets/registry';
import { type AgentSources, createPolicyTools, JobScope, jobContext, type Review, scopeOf, type ToolName, type Triage } from './tools';

export type ModeId = 'triage' | 'extract' | 'diff' | 'review';

export type ModelSource =
  | { kind: 'router'; strong: string; cheap: string }
  | { kind: 'scripted'; name: string; model: (mode: ModeId) => MastraModelConfig };

const MODE_IDS = ['triage', 'extract', 'diff', 'review'] as const satisfies readonly ModeId[];

const MODES = {
  triage: {
    tier: 'cheap',
    tools: ['get_policy_document', 'save_triage'],
    instructions:
      'Mode triage. Call get_policy_document once without section_ids to see the outline. Do not read section text. Call save_triage with the ids of the sections that hold coverage criteria, codes, exclusions, documentation requirements, and site of care. Skip clinical evidence, references, and policy history.',
  },
  extract: {
    tier: 'strong',
    tools: ['get_policy_document', 'save_extraction'],
    instructions:
      'Mode extract. Read the sections the task names with get_policy_document. Read the outline only if those sections look wrong. Fill every save_extraction field from the document text. List each code once under its code system. Restate each criterion faithfully and briefly, and put alternatives in any_of. Use null or an empty list when the document is silent. Call save_extraction once, and if it returns validation errors, fix them and call it again.',
  },
  diff: {
    tier: 'cheap',
    tools: ['get_approved_version', 'save_diff'],
    instructions:
      'Mode diff. The task lists a computed change set. Write a two to five sentence summary for the human reviewer. Lead with changes to criteria, codes, and exclusions. Call get_approved_version only if you need the published rules for context. Call save_diff once with summary.',
  },
  review: {
    tier: 'strong',
    tools: ['get_policy_document', 'save_diff'],
    instructions:
      'Mode review. Check each change in the task against the source document. Read the sections that support the changes. Report each change the document does not support, or supports differently, as a finding. Call save_diff once with review.',
  },
} as const satisfies Record<ModeId, { tier: 'strong' | 'cheap'; tools: readonly ToolName[]; instructions: string }>;

const BASE_INSTRUCTIONS =
  'You are the Anumat policy analyst for US payer prior-authorization and medical coverage policies. Each task names one document, policy, or change set by id. Read documents only through get_policy_document. Use only facts stated in the document and never guess codes, dates, or criteria. Finish by calling the save tool your mode names.';

const MAX_CHANGES_CHARS = 12_000;

export type DocumentJob = { documentId: string; policyKey: string; payer: string; title: string };
export type ExtractResult = {
  triage: Triage;
  extraction: unknown;
  model: string;
  charsRead: number;
  sectionsRead: string[];
};
export type DiffNotes = { summary: string | null; review: Review | null; failures: string[] };

export type PolicyAgent = {
  readonly models: ModelSource;
  extractDocument(job: DocumentJob): Promise<ExtractResult>;
  annotateDiff(job: { diffId: string; documentId: string; policyKey: string; changes: Change[] }): Promise<DiffNotes>;
};

function modelIdFor(models: ModelSource, mode: ModeId): string {
  return models.kind === 'router' ? models[MODES[mode].tier] : `${models.name}/${mode}`;
}

function compactChanges(changes: Change[]): string {
  const json = JSON.stringify(changes);
  return json.length > MAX_CHANGES_CHARS ? `${json.slice(0, MAX_CHANGES_CHARS)} ...(truncated)` : json;
}

export async function createPolicyAgent(options: {
  market: Market;
  models: ModelSource;
  sources: AgentSources;
}): Promise<PolicyAgent> {
  const { market, models, sources } = options;
  const agent = new Agent({
    id: `anumat-${market}-policy-agent`,
    name: 'Anumat policy agent',
    instructions: BASE_INSTRUCTIONS,
    model: ({ requestContext }) => {
      const { mode } = scopeOf(requestContext);
      return models.kind === 'router' ? modelIdFor(models, mode) : models.model(mode);
    },
  });
  const controller = new AgentController({
    id: `anumat-${market}`,
    agent,
    initialState: { yolo: true },
    tools: createPolicyTools(market, sources),
    disableBuiltinTools: ['ask_user', 'submit_plan', 'task_write', 'task_update', 'task_complete', 'task_check', 'subagent'],
    defaultModeId: 'extract',
    modes: MODE_IDS.map((id) => ({
      id,
      name: id,
      instructions: MODES[id].instructions,
      defaultModelId: modelIdFor(models, id),
      availableTools: [...MODES[id].tools],
    })),
  });
  await controller.init();

  async function run(scope: JobScope, content: string): Promise<{ model: string; lastToolError: string | undefined }> {
    const resourceId = `anumat-job:${randomUUID()}`;
    const session = await controller.createSession({ resourceId });
    const errors: string[] = [];
    let lastToolError: string | undefined;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'error') errors.push(event.error.message);
      if (event.type === 'tool_end' && typeof event.result === 'object' && event.result && 'error' in event.result) {
        lastToolError = 'message' in event.result ? String(event.result.message) : 'tool error';
      }
    });
    try {
      await session.mode.switch({ modeId: scope.mode });
      const model = session.model.get();
      if (models.kind === 'router') {
        const auth = await controller.getCurrentModelAuthStatus(session);
        if (!auth.hasAuth) {
          throw new AppError(
            'llm_not_configured',
            `No API key is configured for ${model}. Set ${auth.apiKeyEnvVar ?? 'its provider API key'} to run the ${scope.mode} step.`,
            { mode: scope.mode, model, env_var: auth.apiKeyEnvVar },
          );
        }
      }
      await session.sendMessage({ content, requestContext: jobContext(scope) });
      if (errors.length > 0) {
        throw new AppError('extraction_failed', `The ${scope.mode} step failed: ${errors.join('; ')}`, {
          mode: scope.mode,
          model,
        });
      }
      return { model, lastToolError };
    } finally {
      unsubscribe();
      await controller.deleteSession({ resourceId });
    }
  }

  return {
    models,

    async extractDocument(job) {
      const about = `${job.payer}: ${job.title}`;
      const triageScope = new JobScope('triage', { documentId: job.documentId });
      await run(triageScope, `Triage document ${job.documentId} (${about}). Read its outline, then call save_triage.`);
      const triage = triageScope.triage;
      if (!triage) throw new AppError('extraction_failed', 'The triage step ended without calling save_triage', { mode: 'triage' });
      if (!triage.is_prior_auth_policy) {
        throw new AppError('not_a_policy', `Triage found no prior-auth rules in document ${job.documentId}: ${triage.reason}`);
      }

      const extractScope = new JobScope('extract', { documentId: job.documentId });
      const plan = triage.section_ids.length
        ? `Triage chose these sections: ${triage.section_ids.join(', ')}. Read them with get_policy_document, then call save_extraction.`
        : 'Read the outline with get_policy_document, choose the rule sections, then call save_extraction.';
      const { model, lastToolError } = await run(extractScope, `Extract the prior-auth rules from document ${job.documentId} (${about}). ${plan}`);
      if (extractScope.extraction === undefined) {
        throw new AppError('extraction_failed', 'The extract step ended without a valid save_extraction call', {
          mode: 'extract',
          model,
          last_tool_error: lastToolError,
        });
      }
      return {
        triage,
        extraction: extractScope.extraction,
        model,
        charsRead: triageScope.charsRead + extractScope.charsRead,
        sectionsRead: extractScope.sectionsRead,
      };
    },

    async annotateDiff(job) {
      const changes = compactChanges(job.changes);
      const notes: DiffNotes = { summary: null, review: null, failures: [] };
      const diffScope = new JobScope('diff', { diffId: job.diffId, policyKey: job.policyKey });
      const reviewScope = new JobScope('review', { diffId: job.diffId, documentId: job.documentId });
      const steps = [
        run(diffScope, `Summarize change set ${job.diffId} for policy ${job.policyKey}. Changes: ${changes}`).then(() => {
          notes.summary = diffScope.summary ?? null;
        }),
        run(reviewScope, `Review change set ${job.diffId} against document ${job.documentId}. Changes: ${changes}`).then(() => {
          notes.review = reviewScope.review ?? null;
        }),
      ];
      for (const result of await Promise.allSettled(steps)) {
        if (result.status === 'rejected') notes.failures.push(String(result.reason));
      }
      return notes;
    },
  };
}
