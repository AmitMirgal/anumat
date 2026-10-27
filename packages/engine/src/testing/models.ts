import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import type { ModeId, ModelSource } from '../agent/policy-agent';
import { finalText, type StreamResult } from '../agent/replay-model';

type Step = (options: Parameters<MastraLanguageModelV2Mock['doStream']>[0]) => StreamResult;

export function scriptedModels(script: Partial<Record<ModeId, Step[]>>) {
  const mocks = new Map<ModeId, MastraLanguageModelV2Mock>();
  const source: ModelSource = {
    kind: 'scripted',
    name: 'test',
    model: (mode) => {
      const existing = mocks.get(mode);
      if (existing) return existing;
      let call = 0;
      const steps = script[mode] ?? [];
      const mock = new MastraLanguageModelV2Mock({
        doStream: async (options) => (steps[call++] ?? (() => finalText('done')))(options),
      });
      mocks.set(mode, mock);
      return mock;
    },
  };
  return { source, calls: (mode: ModeId) => mocks.get(mode)?.doStreamCalls ?? [] };
}
