import { expect, test } from 'vitest';
import { extractSchemas } from '../src/registry';

const valid = {
  market: 'us',
  title: 'Bariatric Surgery',
  payer: 'UnitedHealthcare',
  policy_number: '2025T0362KK',
  effective_date: '2025-10-01',
  revision_date: null,
  auth_type: 'medical_necessity',
  codes: [
    { system: 'CPT', code: '43644', display: 'Laparoscopic gastric bypass' },
    { system: 'HCPCS', code: 'S2083' },
    { system: 'ICD-10-CM', code: 'E66.01' },
  ],
  indications: [
    {
      name: 'Bariatric surgery in adults',
      match: 'all',
      criteria: [{ text: 'Body mass index', any_of: ['BMI of 40 or greater', 'BMI of 35 or greater with a comorbidity'] }],
    },
  ],
  exclusions: ['Intragastric balloon'],
  documentation_requirements: ['Weight history'],
  site_of_care: [],
};

function issues(input: unknown) {
  const result = extractSchemas.us.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.code} at ${issue.path.join('.')}`);
}

test('accepts a complete US extraction', () => {
  expect(issues(valid)).toEqual([]);
});

test.each([
  ['a non-US market', { ...valid, market: 'in' }, ['invalid_value at market']],
  ['a malformed CPT code', { ...valid, codes: [{ system: 'CPT', code: '4364' }] }, ['invalid_format at codes.0.code']],
  ['an unknown code system', { ...valid, codes: [{ system: 'NDC', code: '12345' }] }, ['invalid_union at codes.0.system']],
  ['a non-ISO date', { ...valid, effective_date: '10/01/2025' }, ['invalid_format at effective_date']],
  ['an unknown field', { ...valid, notes: 'free text' }, ['unrecognized_keys at ']],
  [
    'an indication without criteria',
    { ...valid, indications: [{ name: 'Adults', match: 'all', criteria: [] }] },
    ['too_small at indications.0.criteria'],
  ],
])('rejects %s', (_label, input, expected) => {
  expect(issues(input)).toEqual(expected);
});
