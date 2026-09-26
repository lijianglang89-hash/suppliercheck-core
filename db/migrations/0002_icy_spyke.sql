CREATE TYPE "public"."review_finding_source" AS ENUM('RULE', 'AI');--> statement-breakpoint
CREATE TYPE "public"."review_run_status" AS ENUM('QUEUED', 'RUNNING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."review_severity" AS ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."supplier_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "review_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"review_run_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"category" text NOT NULL,
	"severity" "review_severity" NOT NULL,
	"source" "review_finding_source" DEFAULT 'RULE' NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"recommendation" text,
	"document_id" uuid,
	"document_label" text,
	"evidence" text,
	"locator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"supplier_id" uuid,
	"template_name" text NOT NULL,
	"template_key" text NOT NULL,
	"template_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "review_run_status" DEFAULT 'QUEUED' NOT NULL,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"engine_provider" text NOT NULL,
	"engine_model" text NOT NULL,
	"engine_mock" boolean DEFAULT true NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"ai_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"based_on_key" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unified_social_credit_code" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"region" text,
	"note" text,
	"status" "supplier_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_review_run_id_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_findings_run_idx" ON "review_findings" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "review_findings_workspace_idx" ON "review_findings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "review_findings_document_idx" ON "review_findings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "review_runs_workspace_idx" ON "review_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "review_runs_workspace_status_idx" ON "review_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "review_templates_workspace_idx" ON "review_templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_templates_workspace_name_unique" ON "review_templates" USING btree ("workspace_id","name") WHERE "review_templates"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "suppliers_workspace_idx" ON "suppliers" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_workspace_name_unique" ON "suppliers" USING btree ("workspace_id","name") WHERE "suppliers"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_supplier_idx" ON "documents" USING btree ("supplier_id");