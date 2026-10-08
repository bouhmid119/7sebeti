-- ai_brief under the same tenant isolation as the other organization tables (see 0002_rls).
-- app_rw already gets its grants through the default privileges set in 0002.
ALTER TABLE ai_brief ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_brief TO app_rw
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
