-- CreateEnum
CREATE TYPE "market" AS ENUM ('us');

-- CreateEnum
CREATE TYPE "adapter_type" AS ENUM ('http_pdf');

-- CreateEnum
CREATE TYPE "converter" AS ENUM ('anydoc', 'firecrawl-parse');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('converted', 'failed');

-- CreateEnum
CREATE TYPE "version_status" AS ENUM ('proposed', 'approved', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "watch_outcome" AS ENUM ('unchanged', 'new_artifact', 'error');

-- CreateTable
CREATE TABLE "payers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "market" "market" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_sources" (
    "id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "market" "market" NOT NULL,
    "policy_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "adapter_type" "adapter_type" NOT NULL DEFAULT 'http_pdf',
    "check_interval_hours" INTEGER NOT NULL DEFAULT 24,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "policy_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_artifacts" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_sha256" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,

    CONSTRAINT "policy_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_documents" (
    "id" UUID NOT NULL,
    "artifact_id" UUID NOT NULL,
    "status" "document_status" NOT NULL,
    "converter" "converter",
    "markdown_path" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "policy_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "market" "market" NOT NULL,
    "policy_key" TEXT NOT NULL,
    "document_id" UUID NOT NULL,
    "base_version_id" UUID,
    "supersedes_id" UUID,
    "status" "version_status" NOT NULL DEFAULT 'proposed',
    "version" INTEGER,
    "extract_schema" TEXT NOT NULL,
    "extracted_json" JSONB NOT NULL,
    "extracted_by" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" TEXT,
    "rejected_at" TIMESTAMPTZ(3),
    "rejected_by" TEXT,
    "reject_reason" TEXT,
    "superseded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_diffs" (
    "id" UUID NOT NULL,
    "policy_key" TEXT NOT NULL,
    "from_version_id" UUID,
    "to_version_id" UUID NOT NULL,
    "diff_json" JSONB NOT NULL,
    "summary" TEXT,
    "review" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "policy_diffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_runs" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,
    "outcome" "watch_outcome" NOT NULL,
    "artifact_id" UUID,
    "version_id" UUID,
    "error_code" TEXT,
    "error_message" TEXT,

    CONSTRAINT "watch_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payers_slug_unique" ON "payers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "payers_id_market_key" ON "payers"("id", "market");

-- CreateIndex
CREATE UNIQUE INDEX "policy_sources_policy_key_unique" ON "policy_sources"("policy_key");

-- CreateIndex
CREATE UNIQUE INDEX "policy_sources_source_url_unique" ON "policy_sources"("source_url");

-- CreateIndex
CREATE INDEX "policy_sources_payer_market_idx" ON "policy_sources"("payer_id", "market");

-- CreateIndex
CREATE UNIQUE INDEX "policy_sources_id_market_policy_key_key" ON "policy_sources"("id", "market", "policy_key");

-- CreateIndex
CREATE INDEX "policy_artifacts_source_fetched_idx" ON "policy_artifacts"("source_id", "fetched_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "policy_documents_artifact_id_unique" ON "policy_documents"("artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_document_id_unique" ON "policy_versions"("document_id");

-- CreateIndex
CREATE INDEX "policy_versions_status_created_idx" ON "policy_versions"("status", "created_at");

-- CreateIndex
CREATE INDEX "policy_versions_source_id_idx" ON "policy_versions"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_policy_key_version_key" ON "policy_versions"("policy_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_one_open_proposal" ON "policy_versions"("policy_key") WHERE (status = 'proposed');

-- CreateIndex
CREATE UNIQUE INDEX "policy_diffs_to_version_id_unique" ON "policy_diffs"("to_version_id");

-- CreateIndex
CREATE INDEX "policy_diffs_from_version_id_idx" ON "policy_diffs"("from_version_id");

-- CreateIndex
CREATE INDEX "watch_runs_source_started_idx" ON "watch_runs"("source_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "policy_sources" ADD CONSTRAINT "policy_sources_payer_id_market_fkey" FOREIGN KEY ("payer_id", "market") REFERENCES "payers"("id", "market") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_artifacts" ADD CONSTRAINT "policy_artifacts_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "policy_sources"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "policy_artifacts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_source_id_market_policy_key_fkey" FOREIGN KEY ("source_id", "market", "policy_key") REFERENCES "policy_sources"("id", "market", "policy_key") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "policy_documents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_base_version_id_fkey" FOREIGN KEY ("base_version_id") REFERENCES "policy_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "policy_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_diffs" ADD CONSTRAINT "policy_diffs_from_version_id_fkey" FOREIGN KEY ("from_version_id") REFERENCES "policy_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_diffs" ADD CONSTRAINT "policy_diffs_to_version_id_fkey" FOREIGN KEY ("to_version_id") REFERENCES "policy_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "policy_sources"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "policy_artifacts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "policy_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Checks and immutability triggers. Prisma's schema language cannot represent these.
-- They keep the previous invariants: field formats, status-dependent columns, and frozen approved rows.

ALTER TABLE "payers" ADD CONSTRAINT "payers_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "policy_sources" ADD CONSTRAINT "policy_sources_check_interval" CHECK ("check_interval_hours" BETWEEN 1 AND 720);

ALTER TABLE "policy_sources" ADD CONSTRAINT "policy_sources_policy_key_format" CHECK ("policy_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*[.][a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "policy_artifacts" ADD CONSTRAINT "policy_artifacts_sha256_hex" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_converted_fields" CHECK (("status" = 'converted') = ("converter" IS NOT NULL AND "markdown_path" IS NOT NULL));

ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_failed_fields" CHECK (("status" = 'failed') = ("error_code" IS NOT NULL));

ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_approved_fields" CHECK (num_nulls("version", "approved_at", "approved_by") = CASE WHEN "status" = 'approved' THEN 0 ELSE 3 END);

ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_rejected_fields" CHECK (num_nulls("rejected_at", "rejected_by") = CASE WHEN "status" = 'rejected' THEN 0 ELSE 2 END);

ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_superseded_fields" CHECK (("superseded_at" IS NOT NULL) = ("status" = 'superseded'));

ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_version_positive" CHECK ("version" > 0);

ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_error_fields" CHECK (("outcome" = 'error') = ("error_code" IS NOT NULL));

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

CREATE TRIGGER policy_versions_guard BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION policy_versions_guard();

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

CREATE TRIGGER policy_diffs_guard BEFORE UPDATE OR DELETE ON policy_diffs
  FOR EACH ROW EXECUTE FUNCTION policy_diffs_guard();
