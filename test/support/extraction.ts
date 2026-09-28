import type { UsExtraction } from '../../src/markets/us/extract-schema';

export const bariatricV1: UsExtraction = {
  market: 'us',
  title: 'Bariatric Surgery',
  payer: 'UnitedHealthcare',
  policy_number: '2026T0362RR',
  effective_date: '2026-05-01',
  revision_date: null,
  auth_type: 'medical_necessity',
  codes: [
    { system: 'CPT', code: '43644', display: 'Laparoscopic gastric bypass' },
    { system: 'CPT', code: '43775', display: 'Laparoscopic longitudinal gastrectomy' },
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

export const bariatricV2: UsExtraction = {
  ...bariatricV1,
  effective_date: '2026-11-01',
  codes: [...bariatricV1.codes, { system: 'CPT', code: '43645', display: 'Laparoscopic gastric bypass with small intestine reconstruction' }],
};
