# @anumat/engine

Fetch, convert, extract, diff, and store policy documents. Catalog and version functions live here because they use the database.

Pass plug-ins (`AuditSink`, `ReviewPolicy`, and the others) as function arguments. The engine does not read them from globals, and it does not import `ee/`.
