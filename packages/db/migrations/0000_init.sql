CREATE TYPE "public"."inbound_event_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('converty', 'converty_sheets', 'dropo', 'cosmos', 'meta');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'agent', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."order_status_category" AS ENUM('pending', 'no_answer', 'callback', 'confirmed', 'refused', 'shipped', 'delivered', 'returned', 'ignored');--> statement-breakpoint
CREATE TABLE "bundle_component" (
	"bundle_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bundle_component_bundle_id_component_id_pk" PRIMARY KEY("bundle_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "external_product_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"external_key" text NOT NULL,
	"display_name" text,
	"product_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" "integration_provider" NOT NULL,
	"event_type" text NOT NULL,
	"external_id" text,
	"payload" jsonb NOT NULL,
	"status" "inbound_event_status" DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integration_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"label" text NOT NULL,
	"external_account_id" text,
	"credentials_encrypted" text,
	"credentials_expire_at" timestamp with time zone,
	"webhook_secret" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_agent_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" "integration_provider" NOT NULL,
	"external_id" text NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"city" text,
	"source_status" text NOT NULL,
	"category" "order_status_category",
	"total" bigint,
	"delivery_fee" bigint,
	"is_test" boolean DEFAULT false NOT NULL,
	"had_upsell" boolean DEFAULT false NOT NULL,
	"confirming_agent" text,
	"source_created_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"source_status" text NOT NULL,
	"category" "order_status_category",
	"attempt" integer,
	"actor" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"external_product_key" text NOT NULL,
	"product_name" text,
	"quantity" integer NOT NULL,
	"unit_price" bigint,
	"is_upsell" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text DEFAULT 'TN' NOT NULL,
	"currency" text DEFAULT 'TND' NOT NULL,
	"timezone" text DEFAULT 'Africa/Tunis' NOT NULL,
	"enabled_modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"is_bundle" boolean DEFAULT false NOT NULL,
	"selling_price" bigint NOT NULL,
	"upsell_price" bigint,
	"cost_price" bigint,
	"packaging_per_unit" bigint DEFAULT 0 NOT NULL,
	"packaging_per_order" bigint DEFAULT 0 NOT NULL,
	"restock_lead_time_days" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"match" text NOT NULL,
	"kind" text NOT NULL,
	"category" "order_status_category" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "bundle_component" ADD CONSTRAINT "bundle_component_bundle_id_product_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_component" ADD CONSTRAINT "bundle_component_component_id_product_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_product_link" ADD CONSTRAINT "external_product_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_product_link" ADD CONSTRAINT "external_product_link_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event" ADD CONSTRAINT "inbound_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_event" ADD CONSTRAINT "inbound_event_connection_id_integration_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_connection_id_integration_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_mapping" ADD CONSTRAINT "status_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_product_link_organization_id_provider_external_key_index" ON "external_product_link" USING btree ("organization_id","provider","external_key");--> statement-breakpoint
CREATE INDEX "inbound_event_organization_id_received_at_index" ON "inbound_event" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_event_status_index" ON "inbound_event" USING btree ("status");--> statement-breakpoint
CREATE INDEX "integration_connection_organization_id_index" ON "integration_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connection_organization_id_provider_external_account_id_index" ON "integration_connection" USING btree ("organization_id","provider","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_organization_id_provider_external_id_index" ON "order" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "order_organization_id_source_created_at_index" ON "order" USING btree ("organization_id","source_created_at");--> statement-breakpoint
CREATE INDEX "order_organization_id_customer_phone_index" ON "order" USING btree ("organization_id","customer_phone");--> statement-breakpoint
CREATE UNIQUE INDEX "order_event_order_id_occurred_at_source_status_index" ON "order_event" USING btree ("order_id","occurred_at","source_status");--> statement-breakpoint
CREATE INDEX "order_event_order_id_index" ON "order_event" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_line_order_id_index" ON "order_line" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "product_organization_id_index" ON "product" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "status_mapping_organization_id_provider_match_kind_index" ON "status_mapping" USING btree ("organization_id","provider","match","kind");