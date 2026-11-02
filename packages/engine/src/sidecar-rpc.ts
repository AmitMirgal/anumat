import { AppError } from '@anumat/core';
import type { AppContext } from './context';
import { callPolicy, camelPolicyInput, policyMethodFromPython, toJson } from './policy-api';

export { toJson };

export async function callEngineMethod(ctx: AppContext, method: string, input: unknown): Promise<unknown> {
  const name = policyMethodFromPython(method);
  if (name === undefined) throw new AppError('not_found', `Unknown engine method ${method}`);
  return callPolicy(ctx, name, camelPolicyInput(input));
}
