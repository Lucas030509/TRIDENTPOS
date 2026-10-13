-- Up
ALTER TABLE fiscal_stamping_operations ADD COLUMN request_xml TEXT;
ALTER TABLE fiscal_stamping_operations ADD COLUMN event_contract_version VARCHAR(20);
ALTER TABLE fiscal_stamping_operations ADD COLUMN event_payload JSONB;
ALTER TABLE consumer_inbox_events ADD COLUMN event_payload JSONB;
ALTER TABLE consumer_inbox_events ALTER COLUMN event_contract_version DROP DEFAULT;
ALTER TABLE fiscal_stamping_operations ADD CONSTRAINT fiscal_event_version_canonical CHECK (
  event_contract_version IS NULL OR event_contract_version ~ '^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$');
ALTER TABLE consumer_inbox_events ADD CONSTRAINT inbox_event_version_canonical CHECK (
  event_contract_version ~ '^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)$');
CREATE OR REPLACE FUNCTION protect_fiscal_event_envelope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_payload IS NOT NULL AND (NEW.event_payload IS DISTINCT FROM OLD.event_payload OR
     NEW.event_contract_version IS DISTINCT FROM OLD.event_contract_version OR
     NEW.semantic_event_id IS DISTINCT FROM OLD.semantic_event_id OR
     NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     to_jsonb(NEW)->>'event_kind' IS DISTINCT FROM to_jsonb(OLD)->>'event_kind' OR
     to_jsonb(NEW)->>'consumer_context' IS DISTINCT FROM to_jsonb(OLD)->>'consumer_context') THEN
    RAISE EXCEPTION 'Immutable fiscal event envelope';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fiscal_event_envelope_immutable ON fiscal_stamping_operations;
CREATE TRIGGER fiscal_event_envelope_immutable BEFORE UPDATE ON fiscal_stamping_operations
FOR EACH ROW EXECUTE FUNCTION protect_fiscal_event_envelope();
DROP TRIGGER IF EXISTS inbox_event_envelope_immutable ON consumer_inbox_events;
CREATE TRIGGER inbox_event_envelope_immutable BEFORE UPDATE ON consumer_inbox_events
FOR EACH ROW EXECUTE FUNCTION protect_fiscal_event_envelope();
ALTER TABLE fiscal_stamping_operations DROP CONSTRAINT IF EXISTS fiscal_envelope_consistent;
ALTER TABLE fiscal_stamping_operations ADD CONSTRAINT fiscal_envelope_consistent CHECK (
  (event_payload IS NULL AND event_contract_version IS NULL) OR
  (event_payload IS NOT NULL AND event_contract_version IS NOT NULL AND
   event_payload->>'eventContractVersion' = event_contract_version AND
   event_payload->>'semanticEventId' = semantic_event_id) IS TRUE);
ALTER TABLE consumer_inbox_events DROP CONSTRAINT IF EXISTS inbox_envelope_consistent;
ALTER TABLE consumer_inbox_events ADD CONSTRAINT inbox_envelope_consistent CHECK (event_payload IS NULL OR
  (event_payload->>'eventContractVersion' = event_contract_version AND
   event_payload->>'semanticEventId' = semantic_event_id) IS TRUE);
CREATE OR REPLACE FUNCTION protect_fiscal_outbox_envelope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_type IN ('FacturaFiscalEmitida', 'FacturaFiscalCancelada') AND
     (NEW.payload IS DISTINCT FROM OLD.payload OR NEW.event_type IS DISTINCT FROM OLD.event_type OR
      NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id) THEN
    RAISE EXCEPTION 'Immutable fiscal outbox envelope';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fiscal_outbox_envelope_immutable ON cloud_integration_outbox;
CREATE TRIGGER fiscal_outbox_envelope_immutable BEFORE UPDATE ON cloud_integration_outbox
FOR EACH ROW EXECUTE FUNCTION protect_fiscal_outbox_envelope();
-- Down
SET LOCAL row_security = off;
LOCK TABLE fiscal_stamping_operations, consumer_inbox_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM fiscal_stamping_operations) OR EXISTS (SELECT 1 FROM consumer_inbox_events) THEN
    RAISE EXCEPTION 'FAIL_CLOSED: fiscal event or recovery state populated';
  END IF;
END $$;
DROP TRIGGER IF EXISTS fiscal_outbox_envelope_immutable ON cloud_integration_outbox;
DROP FUNCTION IF EXISTS protect_fiscal_outbox_envelope();
ALTER TABLE consumer_inbox_events DROP CONSTRAINT IF EXISTS inbox_envelope_consistent;
ALTER TABLE fiscal_stamping_operations DROP CONSTRAINT IF EXISTS fiscal_envelope_consistent;
DROP TRIGGER IF EXISTS inbox_event_envelope_immutable ON consumer_inbox_events;
DROP TRIGGER IF EXISTS fiscal_event_envelope_immutable ON fiscal_stamping_operations;
DROP FUNCTION IF EXISTS protect_fiscal_event_envelope();
ALTER TABLE consumer_inbox_events DROP CONSTRAINT IF EXISTS inbox_event_version_canonical;
ALTER TABLE fiscal_stamping_operations DROP CONSTRAINT IF EXISTS fiscal_event_version_canonical;
ALTER TABLE consumer_inbox_events DROP COLUMN IF EXISTS event_payload;
ALTER TABLE fiscal_stamping_operations DROP COLUMN IF EXISTS request_xml;
ALTER TABLE fiscal_stamping_operations DROP COLUMN IF EXISTS event_payload;
ALTER TABLE fiscal_stamping_operations DROP COLUMN IF EXISTS event_contract_version;
