-- Up
CREATE TABLE IF NOT EXISTS consumer_restore_pending_markers (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    consumer_context VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_consumer_restore_pending PRIMARY KEY (organization_id, consumer_context)
);

ALTER TABLE consumer_restore_pending_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_restore_pending_markers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON consumer_restore_pending_markers
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
SET LOCAL row_security = off;
LOCK TABLE consumer_restore_pending_markers, consumer_inbox_events, fiscal_stamping_operations IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM consumer_restore_pending_markers) OR
     EXISTS (SELECT 1 FROM consumer_inbox_events) OR
     EXISTS (SELECT 1 FROM fiscal_stamping_operations) THEN
    RAISE EXCEPTION 'FAIL_CLOSED: populated consumer_restore_pending_markers; recovery state must not be destroyed';
  END IF;
END $$;
DROP TABLE IF EXISTS consumer_restore_pending_markers;
