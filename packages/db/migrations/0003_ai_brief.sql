CREATE TYPE "public"."ai_brief_status" AS ENUM('empty', 'signals_only', 'pending', 'submitted', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "ai_brief" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brief_date" date NOT NULL,
	"status" "ai_brief_status" NOT NULL,
	"signals" jsonb NOT NULL,
	"payload" jsonb,
	"pseudonyms" jsonb,
	"content" jsonb,
	"model" text,
	"batch_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_brief" ADD CONSTRAINT "ai_brief_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_brief_organization_id_brief_date_index" ON "ai_brief" USING btree ("organization_id","brief_date");--> statement-breakpoint
CREATE INDEX "ai_brief_status_brief_date_index" ON "ai_brief" USING btree ("status","brief_date");