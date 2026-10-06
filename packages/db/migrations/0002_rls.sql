-- Row-level security: every organization-scoped table is only visible to the
-- organization set in `app.org_id` for the current transaction.
--
-- Tenant code runs `SET LOCAL ROLE app_rw` + `set_config('app.org_id', …, true)`
-- (see withTenant in packages/db). app_rw is not the table owner and has no
-- BYPASSRLS, so the policies always apply to it. The connecting user owns the
-- tables and keeps cross-tenant access for migrations and platform jobs
-- (webhook routing, purges, dumps). No context = zero rows, not an error.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT app_rw TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'integration_connection', 'inbound_event', 'external_object_state', 'product',
    'bundle_component', 'external_product_link', 'status_mapping', 'order',
    'order_line', 'order_event'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO app_rw
         USING (organization_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)
         WITH CHECK (organization_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint
-- membership: a user sees their own memberships (to pick an organization) and,
-- inside an organization, its members. Writes only inside the organization.
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_read ON membership FOR SELECT TO app_rw
  USING (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    OR organization_id = nullif(current_setting('app.org_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY membership_write ON membership FOR ALL TO app_rw
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
-- organization: the current one, or any the current user belongs to (read only).
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_read ON organization FOR SELECT TO app_rw
  USING (
    id = nullif(current_setting('app.org_id', true), '')::uuid
    OR id IN (
      SELECT organization_id FROM membership
      WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY organization_update ON organization FOR UPDATE TO app_rw
  USING (id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.org_id', true), '')::uuid);
