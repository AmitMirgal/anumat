# @anumat/engine

## 0.3.0

### Minor Changes

- Fix triage rejecting code-list policy PDFs (policy name + CPT tables) as not_a_policy; empty or partial conversions now return conversion_failed, and not_a_policy errors include what triage saw.

## 0.2.0

### Minor Changes

- e9cfa74: The engine now extracts structured policy rules without a database, with local storage by default and optional S3, GCS, or Supabase storage.
