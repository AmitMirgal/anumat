import { z } from 'zod';

export const US_SCHEMA_ID = 'us.v1';

const text = (max: number) => z.string().min(2).max(max);
const date = z.iso.date().nullable().describe('YYYY-MM-DD, or null when the document does not state it');

const code = <S extends string>(system: S, pattern: RegExp) =>
  z.strictObject({
    system: z.literal(system),
    code: z.string().regex(pattern),
    display: z.string().min(1).max(300).optional(),
  });

export const usCodeSchema = z.discriminatedUnion('system', [
  code('CPT', /^\d{4}[0-9FTU]$/),
  code('HCPCS', /^[A-V]\d{4}$/),
  code('ICD-10-CM', /^[A-Z]\d[0-9A-Z](\.[0-9A-Z]{1,4})?$/),
  code('ICD-10-PCS', /^[0-9A-HJ-NP-Z]{7}$/),
]);

const criterion = z.strictObject({
  text: text(1000),
  any_of: z
    .array(text(500))
    .min(2)
    .max(40)
    .optional()
    .describe('Options when this criterion is met by any one of them'),
});

const indication = z.strictObject({
  name: text(300),
  match: z.enum(['all', 'any']).describe('all: every criterion must be met. any: one criterion is enough'),
  criteria: z.array(criterion).min(1).max(60),
});

const ANCHOR_FIELDS = ['indications', 'codes', 'exclusions', 'documentation_requirements', 'site_of_care'] as const;

export const usExtractSchema = z.strictObject({
  market: z.literal('us'),
  title: text(300),
  payer: text(120),
  policy_number: z.string().min(1).max(60).nullable(),
  effective_date: date,
  revision_date: date,
  auth_type: z
    .enum(['prior_authorization', 'notification', 'medical_necessity', 'not_stated'])
    .describe(
      'prior_authorization also covers precertification. medical_necessity: criteria are stated without an explicit prior-auth requirement',
    ),
  codes: z.array(usCodeSchema).max(500),
  indications: z.array(indication).max(60),
  exclusions: z.array(text(1000)).max(100).describe('Services or conditions the policy does not cover'),
  documentation_requirements: z.array(text(1000)).max(100),
  site_of_care: z.array(text(300)).max(30),
  raw_section_anchors: z
    .array(z.strictObject({ field: z.enum(ANCHOR_FIELDS), section_ids: z.array(z.string().min(1)).min(1).max(20) }))
    .max(20)
    .optional()
    .describe('Outline section ids each field came from'),
});

export type UsExtraction = z.infer<typeof usExtractSchema>;
export type UsCode = z.infer<typeof usCodeSchema>;
