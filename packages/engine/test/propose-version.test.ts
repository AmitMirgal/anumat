import { expectTypeOf, test } from 'vitest';
import { proposeVersion, type ProposeVersionResult } from '../src/publish';

test('proposeVersion returns the version, diff, and created flag', () => {
  expectTypeOf<Awaited<ReturnType<typeof proposeVersion>>>().toEqualTypeOf<ProposeVersionResult>();
});
