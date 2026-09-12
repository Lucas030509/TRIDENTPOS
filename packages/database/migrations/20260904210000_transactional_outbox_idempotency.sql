-- Up
-- ============================================================================
-- TRIDENTPOS — WP-012: Transactional Outbox & Ingested Idempotency Engine
-- Architecture Baselines: SYNC_AND_OFFLINE_ARCHITECTURE.md Sec 2,
-- ADR-006 (Transactional Outbox & Ingested Idempotency), ADR-007 (Cloud Integration Outbox)
-- ============================================================================

-- 1. Ingested Idempotency Log
CREATE TABLE ingested_idempotency_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    client_op_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    aggregate_sequence_number BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL,
    response_payload JSONB NOT NULL,
    receipt_token VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_idempotency_log_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT uq_idempotency_log_key UNIQUE (organization_id, idempotency_key),
    CONSTRAINT uq_idempotency_log_client_op UNIQUE (organization_id, branch_id, aggregate_type, aggregate_id, action, client_op_id),
    CONSTRAINT chk_idempotency_log_status CHECK (status IN ('RECEIVED', 'DURABLY_STORED', 'APPLIED', 'DUPLICATE_ACCEPTED', 'REJECTED', 'REQUIRES_RECONCILIATION'))
);

CREATE INDEX idx_idempotency_log_lookup ON ingested_idempotency_log (organization_id, branch_id, aggregate_type, aggregate_id);
CREATE INDEX idx_idempotency_log_created_at ON ingested_idempotency_log (created_at);

ALTER TABLE ingested_idempotency_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingested_idempotency_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON ingested_idempotency_log
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 2. Aggregate Sequences (Per-stream causal monotonicity tracking)
CREATE TABLE aggregate_sequences (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    current_sequence_number BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_aggregate_sequences PRIMARY KEY (organization_id, branch_id, aggregate_type, aggregate_id),
    CONSTRAINT fk_aggregate_sequences_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

ALTER TABLE aggregate_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_sequences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON aggregate_sequences
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 3. Reordering Buffer Queue (Sequence gap buffering)
CREATE TABLE reordering_buffer_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    aggregate_sequence_number BIGINT NOT NULL,
    action VARCHAR(100) NOT NULL,
    client_op_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'BUFFERED',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    drained_at TIMESTAMPTZ NULL,
    CONSTRAINT fk_reordering_buffer_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id),
    CONSTRAINT uq_reordering_buffer_seq UNIQUE (organization_id, branch_id, aggregate_type, aggregate_id, aggregate_sequence_number),
    CONSTRAINT uq_reordering_buffer_key UNIQUE (organization_id, idempotency_key),
    CONSTRAINT chk_reordering_buffer_status CHECK (status IN ('BUFFERED', 'DRAINED'))
);

CREATE INDEX idx_reordering_buffer_stream ON reordering_buffer_queue (organization_id, branch_id, aggregate_type, aggregate_id, aggregate_sequence_number);
CREATE INDEX idx_reordering_buffer_status ON reordering_buffer_queue (status);

ALTER TABLE reordering_buffer_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE reordering_buffer_queue FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON reordering_buffer_queue
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 4. Cloud Integration Outbox (ADR-007)
CREATE TABLE cloud_integration_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NULL,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT NULL,
    lock_id VARCHAR(100) NULL,
    locked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_cloud_outbox_status CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DLQ'))
);

CREATE INDEX idx_cloud_outbox_pending ON cloud_integration_outbox (status, next_retry_at) WHERE status IN ('PENDING', 'PROCESSING');
CREATE INDEX idx_cloud_outbox_org ON cloud_integration_outbox (organization_id);

ALTER TABLE cloud_integration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_integration_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON cloud_integration_outbox
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 5. Cloud Integration DLQ (Dead Letter Queue)
CREATE TABLE cloud_integration_dlq (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    originating_outbox_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    raw_payload JSONB NOT NULL,
    error_code VARCHAR(100) NOT NULL,
    error_message TEXT NOT NULL,
    error_trace TEXT NULL,
    retry_count INT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    moved_to_dlq_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cloud_dlq_org ON cloud_integration_dlq (organization_id);
CREATE INDEX idx_cloud_dlq_created ON cloud_integration_dlq (moved_to_dlq_at);

ALTER TABLE cloud_integration_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_integration_dlq FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON cloud_integration_dlq
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- 6. Test Domain Fixture (for WP012-T30, WP012-T31 atomicity testing)
CREATE TABLE wp012_test_domain_fixtures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    value VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_test_domain_fixtures_branch FOREIGN KEY (organization_id, branch_id) REFERENCES branches(organization_id, id)
);

ALTER TABLE wp012_test_domain_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE wp012_test_domain_fixtures FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON wp012_test_domain_fixtures
    FOR ALL
    USING (organization_id = current_app_org_id())
    WITH CHECK (organization_id = current_app_org_id());

-- Down
DROP POLICY IF EXISTS tenant_isolation_policy ON wp012_test_domain_fixtures;
ALTER TABLE IF EXISTS wp012_test_domain_fixtures NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS wp012_test_domain_fixtures DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS wp012_test_domain_fixtures CASCADE;

DROP POLICY IF EXISTS tenant_isolation_policy ON cloud_integration_dlq;
ALTER TABLE IF EXISTS cloud_integration_dlq NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cloud_integration_dlq DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS cloud_integration_dlq CASCADE;

DROP POLICY IF EXISTS tenant_isolation_policy ON cloud_integration_outbox;
ALTER TABLE IF EXISTS cloud_integration_outbox NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cloud_integration_outbox DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS cloud_integration_outbox CASCADE;

DROP POLICY IF EXISTS tenant_isolation_policy ON reordering_buffer_queue;
ALTER TABLE IF EXISTS reordering_buffer_queue NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reordering_buffer_queue DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS reordering_buffer_queue CASCADE;

DROP POLICY IF EXISTS tenant_isolation_policy ON aggregate_sequences;
ALTER TABLE IF EXISTS aggregate_sequences NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS aggregate_sequences DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS aggregate_sequences CASCADE;

DROP POLICY IF EXISTS tenant_isolation_policy ON ingested_idempotency_log;
ALTER TABLE IF EXISTS ingested_idempotency_log NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ingested_idempotency_log DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS ingested_idempotency_log CASCADE;
