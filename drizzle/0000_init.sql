CREATE TYPE "public"."adapter_type" AS ENUM('http_pdf');--> statement-breakpoint
CREATE TYPE "public"."converter" AS ENUM('anydoc', 'firecrawl-parse');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('converted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('us');--> statement-breakpoint
CREATE TYPE "public"."version_status" AS ENUM('proposed', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."watch_outcome" AS ENUM('unchanged', 'new_artifact', 'error');--> statement-breakpoint
CREATE TABLE "payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"market" "market" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "payers_id_market_key" UNIQUE("id","market"),
	CONSTRAINT "payers_slug_format" CHECK ("payers"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "policy_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime" text NOT NULL,
	"byte_size" integer NOT NULL,
	CONSTRAINT "policy_artifacts_sha256_hex" CHECK ("policy_artifacts"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "policy_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_key" text NOT NULL,
	"from_version_id" uuid,
	"to_version_id" uuid NOT NULL,
	"diff_json" jsonb NOT NULL,
	"summary" text,
	"review" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_diffs_to_version_id_unique" UNIQUE("to_version_id")
);
--> statement-breakpoint
CREATE TABLE "policy_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"status" "document_status" NOT NULL,
	"converter" "converter",
	"markdown_path" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_documents_artifact_id_unique" UNIQUE("artifact_id"),
	CONSTRAINT "policy_documents_converted_fields" CHECK (("policy_documents"."status" = 'converted') = ("policy_documents"."converter" is not null and "policy_documents"."markdown_path" is not null)),
	CONSTRAINT "policy_documents_failed_fields" CHECK (("policy_documents"."status" = 'failed') = ("policy_documents"."error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "policy_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payer_id" uuid NOT NULL,
	"market" "market" NOT NULL,
	"policy_key" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"adapter_type" "adapter_type" DEFAULT 'http_pdf' NOT NULL,
	"check_interval_hours" integer DEFAULT 24 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_sources_policy_key_unique" UNIQUE("policy_key"),
	CONSTRAINT "policy_sources_source_url_unique" UNIQUE("source_url"),
	CONSTRAINT "policy_sources_id_market_policy_key_key" UNIQUE("id","market","policy_key"),
	CONSTRAINT "policy_sources_check_interval" CHECK ("policy_sources"."check_interval_hours" between 1 and 720),
	CONSTRAINT "policy_sources_policy_key_format" CHECK ("policy_sources"."policy_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*[.][a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"market" "market" NOT NULL,
	"policy_key" text NOT NULL,
	"document_id" uuid NOT NULL,
	"base_version_id" uuid,
	"supersedes_id" uuid,
	"status" "version_status" DEFAULT 'proposed' NOT NULL,
	"version" integer,
	"extract_schema" text NOT NULL,
	"extracted_json" jsonb NOT NULL,
	"extracted_by" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"rejected_at" timestamp with time zone,
	"rejected_by" text,
	"reject_reason" text,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "policy_versions_policy_key_version_key" UNIQUE("policy_key","version"),
	CONSTRAINT "policy_versions_approved_fields" CHECK (num_nulls("policy_versions"."version", "policy_versions"."approved_at", "policy_versions"."approved_by") = case when "policy_versions"."status" = 'approved' then 0 else 3 end),
	CONSTRAINT "policy_versions_rejected_fields" CHECK (num_nulls("policy_versions"."rejected_at", "policy_versions"."rejected_by") = case when "policy_versions"."status" = 'rejected' then 0 else 2 end),
	CONSTRAINT "policy_versions_superseded_fields" CHECK (("policy_versions"."superseded_at" is not null) = ("policy_versions"."status" = 'superseded')),
	CONSTRAINT "policy_versions_version_positive" CHECK ("policy_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "watch_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"outcome" "watch_outcome" NOT NULL,
	"artifact_id" uuid,
	"version_id" uuid,
	"error_code" text,
	"error_message" text,
	CONSTRAINT "watch_runs_error_fields" CHECK (("watch_runs"."outcome" = 'error') = ("watch_runs"."error_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "policy_artifacts" ADD CONSTRAINT "policy_artifacts_source_id_policy_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."policy_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_diffs" ADD CONSTRAINT "policy_diffs_from_version_id_policy_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_diffs" ADD CONSTRAINT "policy_diffs_to_version_id_policy_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_artifact_id_policy_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."policy_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_sources" ADD CONSTRAINT "policy_sources_payer_id_market_payers_id_market_fk" FOREIGN KEY ("payer_id","market") REFERENCES "public"."payers"("id","market") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_document_id_policy_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."policy_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_base_version_id_policy_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_supersedes_id_policy_versions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_source_id_market_policy_key_policy_sources_id_market_policy_key_fk" FOREIGN KEY ("source_id","market","policy_key") REFERENCES "public"."policy_sources"("id","market","policy_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_source_id_policy_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."policy_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_artifact_id_policy_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."policy_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_artifacts_source_fetched_idx" ON "policy_artifacts" USING btree ("source_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_one_open_proposal" ON "policy_versions" USING btree ("policy_key") WHERE "policy_versions"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "policy_versions_status_created_idx" ON "policy_versions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "watch_runs_source_started_idx" ON "watch_runs" USING btree ("source_id","started_at" DESC NULLS LAST);