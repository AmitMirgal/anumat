export const US_SEED_PAYERS = [
  { slug: 'uhc', name: 'UnitedHealthcare' },
  { slug: 'cigna', name: 'Cigna' },
] as const;

export const US_SEED_SOURCES = [
  {
    payerSlug: 'uhc',
    policySlug: 'bariatric-surgery',
    title: 'Bariatric Surgery',
    sourceUrl:
      'https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/bariatric-surgery.pdf',
  },
  {
    payerSlug: 'uhc',
    policySlug: 'obstructive-sleep-apnea-treatment',
    title: 'Obstructive and Central Sleep Apnea Treatment',
    sourceUrl:
      'https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/obstructive-sleep-apnea-treatment.pdf',
  },
  {
    payerSlug: 'cigna',
    policySlug: 'bariatric-surgery',
    title: 'Bariatric Surgery and Procedures',
    sourceUrl:
      'https://static.cigna.com/assets/chcp/pdf/coveragePolicies/medical/mm_0051_coveragepositioncriteria_bariatric_surgery.pdf',
  },
] as const;
