# Golden extraction fixtures

Each directory holds one US payer policy case for the offline extraction eval.

## Where the documents come from

Each `document.md` comes from a live payer PDF downloaded on 2026-09-28.
`@firecrawl/anydoc` 0.2.4 converted each PDF to markdown.
The table lists the source PDF and the converted markdown lines each excerpt keeps.

| Case | Source PDF | Kept lines |
| --- | --- | --- |
| `uhc.bariatric-surgery` | [UHC Bariatric Surgery](https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/bariatric-surgery.pdf) | 1-29, 40-105, 137-185, 304-306 |
| `uhc.obstructive-sleep-apnea-treatment` | [UHC Obstructive and Central Sleep Apnea Treatment](https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/obstructive-sleep-apnea-treatment.pdf) | 1-33, 44-94, 117-182, 204-212 |
| `cigna.bariatric-surgery` | [Cigna Bariatric Surgery and Procedures](https://static.cigna.com/assets/chcp/pdf/coveragePolicies/medical/mm_0051_coveragepositioncriteria_bariatric_surgery.pdf) | 1-12, 17-424 |

The Cigna excerpt is about 33,700 characters, above the 20,000 character target, because its coverage and coding sections together exceed the target and every CPT and HCPCS row stays.

## What each file holds

`document.md` is a verbatim excerpt of the converted markdown.
Every line matches a source line exactly, in source order.
The excerpt drops whole sections and never rewords or reorders kept text.
Every heading line in the kept text is unchanged, because the product splits documents into sections on headings.
`case.json` names the kept sections in its `excerpt` field.

`expected.json` is hand-written gold.
It uses only facts stated in `document.md`.

`candidate.json` is a hand-written imperfect extraction.
It starts from the gold and adds the mistakes listed in `candidate_deviations` in `case.json`.
The offline eval replays it through the agent tools.
It is not model output.

## Check the fixtures

Run `pnpm exec vitest run test/fixtures.test.ts` from the repository root.
It checks the case names, that both JSON files pass the US schema, that each candidate differs from its gold, and that each document has headings.
