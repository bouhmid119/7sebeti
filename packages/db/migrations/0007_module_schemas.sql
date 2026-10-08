-- One Postgres schema per module (decision of 8 October 2026). Tables and enum types move
-- out of public; data, indexes, constraints, row-level security policies and table grants
-- move with them. app_rw gets usage on each module schema and default privileges there.
CREATE SCHEMA IF NOT EXISTS identity;
--> statement-breakpoint
ALTER TYPE public."member_role" SET SCHEMA identity;
--> statement-breakpoint
ALTER TABLE public."organization" SET SCHEMA identity;
--> statement-breakpoint
ALTER TABLE public."user" SET SCHEMA identity;
--> statement-breakpoint
ALTER TABLE public."session" SET SCHEMA identity;
--> statement-breakpoint
ALTER TABLE public."account" SET SCHEMA identity;
--> statement-breakpoint
ALTER TABLE public."verification" SET SCHEMA identity;
--> statement-breakpoint
ALTER TABLE public."two_factor" SET SCHEMA identity;
--> statement-breakpoint
ALTER TABLE public."membership" SET SCHEMA identity;
--> statement-breakpoint
GRANT USAGE ON SCHEMA identity TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS connectors;
--> statement-breakpoint
ALTER TYPE public."integration_provider" SET SCHEMA connectors;
--> statement-breakpoint
ALTER TYPE public."inbound_event_status" SET SCHEMA connectors;
--> statement-breakpoint
ALTER TABLE public."integration_connection" SET SCHEMA connectors;
--> statement-breakpoint
ALTER TABLE public."inbound_event" SET SCHEMA connectors;
--> statement-breakpoint
ALTER TABLE public."external_object_state" SET SCHEMA connectors;
--> statement-breakpoint
GRANT USAGE ON SCHEMA connectors TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA connectors TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA connectors GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS catalog;
--> statement-breakpoint
ALTER TABLE public."product" SET SCHEMA catalog;
--> statement-breakpoint
ALTER TABLE public."bundle_component" SET SCHEMA catalog;
--> statement-breakpoint
ALTER TABLE public."external_product_link" SET SCHEMA catalog;
--> statement-breakpoint
GRANT USAGE ON SCHEMA catalog TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalog TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA catalog GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS orders;
--> statement-breakpoint
ALTER TYPE public."order_status_category" SET SCHEMA orders;
--> statement-breakpoint
ALTER TABLE public."status_mapping" SET SCHEMA orders;
--> statement-breakpoint
ALTER TABLE public."order" SET SCHEMA orders;
--> statement-breakpoint
ALTER TABLE public."order_line" SET SCHEMA orders;
--> statement-breakpoint
ALTER TABLE public."order_event" SET SCHEMA orders;
--> statement-breakpoint
GRANT USAGE ON SCHEMA orders TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA orders TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA orders GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS assistant;
--> statement-breakpoint
ALTER TYPE public."ai_brief_status" SET SCHEMA assistant;
--> statement-breakpoint
ALTER TYPE public."ai_brief_shown_as" SET SCHEMA assistant;
--> statement-breakpoint
ALTER TYPE public."ai_brief_verdict" SET SCHEMA assistant;
--> statement-breakpoint
ALTER TABLE public."ai_brief" SET SCHEMA assistant;
--> statement-breakpoint
ALTER TABLE public."ai_brief_feedback" SET SCHEMA assistant;
--> statement-breakpoint
GRANT USAGE ON SCHEMA assistant TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA assistant TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA assistant GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
