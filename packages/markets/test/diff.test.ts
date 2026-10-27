import { expect, test } from 'vitest';
import { diffUsExtractions } from '../src/us/diff';
import type { UsExtraction } from '../src/us/extract-schema';

const v1: UsExtraction = {
  market: 'us',
  title: 'Bariatric Surgery',
  payer: 'UnitedHealthcare',
  policy_number: '2025T0362KK',
  effective_date: '2025-10-01',
  revision_date: null,
  auth_type: 'medical_necessity',
  codes: [
    { system: 'CPT', code: '43644', display: 'Laparoscopic gastric bypass' },
    { system: 'CPT', code: '43775' },
  ],
  indications: [{ name: 'Adults', match: 'all', criteria: [{ text: 'BMI of 40 or greater' }] }],
  exclusions: ['Intragastric balloon'],
  documentation_requirements: [],
  site_of_care: [],
};

test('the first version reports every value as new', () => {
  expect(diffUsExtractions(null, v1)).toEqual([
    { field: 'title', kind: 'changed', before: null, after: 'Bariatric Surgery' },
    { field: 'payer', kind: 'changed', before: null, after: 'UnitedHealthcare' },
    { field: 'policy_number', kind: 'changed', before: null, after: '2025T0362KK' },
    { field: 'effective_date', kind: 'changed', before: null, after: '2025-10-01' },
    { field: 'auth_type', kind: 'changed', before: null, after: 'medical_necessity' },
    { field: 'codes', kind: 'added', key: 'CPT 43644', after: v1.codes[0] },
    { field: 'codes', kind: 'added', key: 'CPT 43775', after: v1.codes[1] },
    { field: 'indications', kind: 'added', key: 'Adults', after: v1.indications[0] },
    { field: 'exclusions', kind: 'added', after: 'Intragastric balloon' },
  ]);
});

test('a revision reports changed dates, codes, and criteria', () => {
  const v2: UsExtraction = {
    ...v1,
    effective_date: '2026-01-01',
    codes: [
      { system: 'CPT', code: '43644', display: 'Laparoscopic gastric bypass' },
      { system: 'CPT', code: '43645' },
    ],
    indications: [{ name: 'Adults', match: 'all', criteria: [{ text: 'BMI of 35 or greater' }] }],
  };
  expect(diffUsExtractions(v1, v2)).toEqual([
    { field: 'effective_date', kind: 'changed', before: '2025-10-01', after: '2026-01-01' },
    { field: 'codes', kind: 'added', key: 'CPT 43645', after: { system: 'CPT', code: '43645' } },
    { field: 'codes', kind: 'removed', key: 'CPT 43775', before: { system: 'CPT', code: '43775' } },
    { field: 'criteria', kind: 'removed', key: 'Adults', before: 'BMI of 40 or greater' },
    { field: 'criteria', kind: 'added', key: 'Adults', after: 'BMI of 35 or greater' },
  ]);
});

test('case and spacing differences in list items are not changes', () => {
  expect(diffUsExtractions(v1, { ...v1, exclusions: ['  intragastric   BALLOON '] })).toEqual([]);
});
