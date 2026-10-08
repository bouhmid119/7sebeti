-- ai_brief_feedback under the same tenant isolation as the other organization tables (see 0002_rls).
-- On write, the brief must also be visible to the tenant: the subquery on ai_brief runs under
-- its own policy, so feedback can never point at another organization's brief.
ALTER TABLE ai_brief_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_brief_feedback TO app_rw
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (
    organization_id = nullif(current_setting('app.org_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM ai_brief b WHERE b.id = brief_id)
  );
