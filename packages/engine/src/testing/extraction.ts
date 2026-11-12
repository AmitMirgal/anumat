import type { UsExtraction } from '@anumat/markets';

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

export const priorAuthCodeList: UsExtraction = {
  market: 'us',
  title: 'Commercial Prior Authorization Procedure Code List',
  payer: 'Example Health',
  policy_number: null,
  effective_date: '2026-01-01',
  revision_date: null,
  auth_type: 'prior_authorization',
  codes: [
    { system: 'CPT', code: '43644', display: 'Bariatric Surgery' },
    { system: 'CPT', code: '43645', display: 'Bariatric Surgery' },
    { system: 'CPT', code: '43775', display: 'Bariatric Surgery' },
    { system: 'CPT', code: '95810', display: 'Obstructive Sleep Apnea Treatment' },
    { system: 'CPT', code: '95811', display: 'Obstructive Sleep Apnea Treatment' },
  ],
  indications: [
    {
      name: 'Services on this list',
      match: 'all',
      criteria: [{ text: 'Services on this list require prior authorization.' }],
    },
  ],
  exclusions: [],
  documentation_requirements: [],
  site_of_care: [],
};
