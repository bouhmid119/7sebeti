CREATE TYPE "public"."ai_brief_source" AS ENUM('ai', 'rules');--> statement-breakpoint
CREATE TYPE "public"."ai_brief_verdict" AS ENUM('done', 'not_relevant');--> statement-breakpoint
CREATE TABLE "ai_brief_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brief_id" uuid NOT NULL,
	"signal_ref" text NOT NULL,
	"code" text NOT NULL,
	"verdict" "ai_brief_verdict" NOT NULL,
	"source" "ai_brief_source" NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_brief_feedback" ADD CONSTRAINT "ai_brief_feedback_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_brief_feedback" ADD CONSTRAINT "ai_brief_feedback_brief_id_ai_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."ai_brief"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_brief_feedback" ADD CONSTRAINT "ai_brief_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_brief_feedback_brief_id_signal_ref_index" ON "ai_brief_feedback" USING btree ("brief_id","signal_ref");--> statement-breakpoint
CREATE INDEX "ai_brief_feedback_organization_id_code_index" ON "ai_brief_feedback" USING btree ("organization_id","code");