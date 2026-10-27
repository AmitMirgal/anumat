import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MastraLanguageModelV2Mock, simulateReadableStream } from '@mastra/core/test-utils/llm-mock';
import { z } from 'zod';
import type { ModeId, ModelSource } from './policy-agent';

type CallOptions = Parameters<MastraLanguageModelV2Mock['doStream']>[0];
export type StreamResult = Awaited<ReturnType<MastraLanguageModelV2Mock['doStream']>>;
export type PolicyRef = { payer: string; title: string };

const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export function toolCall(toolName: string, input: unknown): StreamResult {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: `${toolName}-${randomUUID()}`, toolName, input: JSON.stringify(input) },
        { type: 'finish', finishReason: 'tool-calls', usage },
      ],
    }),
  };
}

export function finalText(text: string): StreamResult {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: text },
        { type: 'text-end', id: 'text' },
        { type: 'finish', finishReason: 'stop', usage },
      ],
    }),
  };
}

export function toolResults(prompt: CallOptions['prompt']): { toolName: string; value: unknown }[] {
  return prompt.flatMap((message) =>
    message.role === 'tool'
      ? message.content.flatMap((part) =>
          part.type === 'tool-result' ? [{ toolName: part.toolName, value: part.output.type === 'json' ? part.output.value : undefined }] : [],
        )
      : [],
  );
}

function taskText(prompt: CallOptions['prompt']): string {
  return prompt
    .flatMap((message) => (message.role === 'user' ? message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])) : []))
    .join('\n');
}

const outlineResult = z.object({ sections: z.array(z.object({ id: z.string(), level: z.number(), heading: z.string() })) });
const RULE_HEADING = /coverage|codes|coding|documentation|criteria/i;

function ruleSections(outline: unknown): string[] {
  const parsed = outlineResult.safeParse(outline);
  if (!parsed.success) return [];
  return parsed.data.sections
    .filter((section) => section.level <= 2 && RULE_HEADING.test(section.heading))
    .map((section) => section.id)
    .slice(0, 12);
}

function replayStep(mode: ModeId, options: CallOptions, extractionFor: (ref: PolicyRef) => unknown): StreamResult {
  const task = taskText(options.prompt);
  const documentId = /document ([0-9a-f-]{36})/.exec(task)?.[1];
  const ref = /\((?<payer>[^:)]+): (?<title>[^)]+)\)/.exec(task)?.groups;
  const results = toolResults(options.prompt);
  const reads = results.filter((result) => result.toolName === 'get_policy_document');
  if (!documentId || !ref?.payer || !ref.title) return finalText('Replay: the task names no document.');

  if (mode === 'triage') {
    const outline = reads[0];
    if (!outline) return toolCall('get_policy_document', { document_id: documentId });
    if (results.some((result) => result.toolName === 'save_triage')) return finalText('Replay triage saved.');
    return toolCall('save_triage', {
      document_id: documentId,
      triage: { is_prior_auth_policy: true, section_ids: ruleSections(outline.value), reason: 'Replay model: sections chosen by heading keywords.' },
    });
  }

  if (mode === 'extract') {
    const planned = /sections: ([^.]+)\./.exec(task)?.[1]?.split(', ');
    if (reads.length === 0) {
      return toolCall('get_policy_document', planned ? { document_id: documentId, section_ids: planned } : { document_id: documentId });
    }
    if (results.some((result) => result.toolName === 'save_extraction')) return finalText('Replay extraction saved.');
    const extraction = extractionFor({ payer: ref.payer, title: ref.title });
    if (extraction === undefined) return finalText(`Replay: no fixture for ${ref.payer}: ${ref.title}.`);
    return toolCall('save_extraction', { document_id: documentId, extraction });
  }

  return finalText(`Replay does not script the ${mode} mode.`);
}

export function replayModels(extractionFor: (ref: PolicyRef) => unknown): ModelSource {
  return {
    kind: 'scripted',
    name: 'replay',
    model: (mode) => new MastraLanguageModelV2Mock({ doStream: async (options) => replayStep(mode, options, extractionFor) }),
  };
}

const refKey = (ref: PolicyRef) => `${ref.payer}|${ref.title}`.toLowerCase();

export function fixtureExtractions(fixturesDir: string, file: 'expected.json' | 'candidate.json') {
  const byRef = new Map<string, unknown>();
  for (const entry of readdirSync(fixturesDir, { withFileTypes: true })) {
    const dir = join(fixturesDir, entry.name);
    if (!entry.isDirectory() || !existsSync(join(dir, file))) continue;
    const meta = z.object({ payer: z.string(), title: z.string() }).parse(JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')));
    byRef.set(refKey(meta), JSON.parse(readFileSync(join(dir, file), 'utf8')));
  }
  return (ref: PolicyRef) => byRef.get(refKey(ref));
}
