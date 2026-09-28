CREATE FUNCTION policy_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'policy_versions rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'policy version % is % and cannot change', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.extracted_json IS DISTINCT FROM OLD.extracted_json
    OR NEW.extract_schema IS DISTINCT FROM OLD.extract_schema
    OR NEW.extracted_by IS DISTINCT FROM OLD.extracted_by
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.market IS DISTINCT FROM OLD.market
    OR NEW.policy_key IS DISTINCT FROM OLD.policy_key
    OR NEW.base_version_id IS DISTINCT FROM OLD.base_version_id
    OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
    RAISE EXCEPTION 'policy version % content cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER policy_versions_guard BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION policy_versions_guard();
--> statement-breakpoint
CREATE FUNCTION policy_diffs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'policy_diffs rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.diff_json IS DISTINCT FROM OLD.diff_json
    OR NEW.policy_key IS DISTINCT FROM OLD.policy_key
    OR NEW.from_version_id IS DISTINCT FROM OLD.from_version_id
    OR NEW.to_version_id IS DISTINCT FROM OLD.to_version_id THEN
    RAISE EXCEPTION 'policy diff % change set cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER policy_diffs_guard BEFORE UPDATE OR DELETE ON policy_diffs
  FOR EACH ROW EXECUTE FUNCTION policy_diffs_guard();
