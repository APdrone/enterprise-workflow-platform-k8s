import { pool } from './client.js';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('[workflow-api] Running database migrations...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        type VARCHAR(32) NOT NULL DEFAULT 'EXPENSE',
        title VARCHAR(255) NOT NULL,
        description TEXT,
        amount NUMERIC(12, 2),
        currency VARCHAR(8) DEFAULT 'USD',
        requester_id VARCHAR(64) NOT NULL,
        requester_name VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
        approver_id VARCHAR(64),
        current_step_order INT NOT NULL DEFAULT 1,
        total_steps INT NOT NULL DEFAULT 1,
        rejection_reason TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE workflows ADD COLUMN IF NOT EXISTS current_step_order INT NOT NULL DEFAULT 1;
      ALTER TABLE workflows ADD COLUMN IF NOT EXISTS total_steps INT NOT NULL DEFAULT 1;

      CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON workflows(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
      CREATE INDEX IF NOT EXISTS idx_workflows_requester ON workflows(requester_id);
      CREATE INDEX IF NOT EXISTS idx_workflows_tenant_status ON workflows(tenant_id, status);

      CREATE TABLE IF NOT EXISTS workflow_steps (
        id VARCHAR(64) PRIMARY KEY,
        workflow_id VARCHAR(64) NOT NULL,
        tenant_id VARCHAR(64) NOT NULL,
        step_order INT NOT NULL DEFAULT 1,
        step_role VARCHAR(64) NOT NULL DEFAULT 'GENERAL_APPROVER',
        approver_id VARCHAR(64),
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        acted_by VARCHAR(64),
        acted_at TIMESTAMPTZ,
        delegated_from VARCHAR(64),
        comment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_steps_wf ON workflow_steps(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_steps_tenant ON workflow_steps(tenant_id);

      ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS policy VARCHAR(32) NOT NULL DEFAULT 'ALL_MUST_APPROVE';
      ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS parallel_group VARCHAR(64);

      CREATE TABLE IF NOT EXISTS workflow_rules (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        workflow_type VARCHAR(32) NOT NULL DEFAULT 'EXPENSE',
        name VARCHAR(255) NOT NULL,
        description TEXT,
        min_amount NUMERIC(12, 2),
        max_amount NUMERIC(12, 2),
        department VARCHAR(64),
        priority INT NOT NULL DEFAULT 0,
        steps JSONB NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_rules_tenant_type ON workflow_rules(tenant_id, workflow_type, active);

      CREATE TABLE IF NOT EXISTS delegations (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        delegator_id VARCHAR(64) NOT NULL,
        delegatee_id VARCHAR(64) NOT NULL,
        valid_from TIMESTAMPTZ NOT NULL,
        valid_until TIMESTAMPTZ NOT NULL,
        reason TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_delegations_tenant_del ON delegations(tenant_id, delegator_id, delegatee_id);

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id VARCHAR(128) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        key VARCHAR(128) NOT NULL,
        status_code INT,
        response_body JSONB,
        status VARCHAR(32) NOT NULL DEFAULT 'PROCESSING',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_idempotency_tenant_key ON idempotency_keys(tenant_id, key);

      CREATE TABLE IF NOT EXISTS outbox_events (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        workflow_id VARCHAR(64) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        payload JSONB NOT NULL,
        published BOOLEAN NOT NULL DEFAULT FALSE,
        published_at TIMESTAMPTZ,
        retry_count INT NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_published ON outbox_events(published, created_at);

      -- Row-Level Security (RLS) Hardening
      DO $$
      DECLARE
        tbl TEXT;
        tables TEXT[] := ARRAY['workflows', 'workflow_steps', 'workflow_rules', 'delegations', 'idempotency_keys', 'outbox_events'];
      BEGIN
        FOREACH tbl IN ARRAY tables LOOP
          EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
          EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
          EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I;', tbl);
          EXECUTE format('
            CREATE POLICY tenant_isolation_policy ON %I
            FOR ALL
            USING (
              current_setting(''app.bypass_rls'', true) = ''on''
              OR (
                NULLIF(current_setting(''app.current_tenant_id'', true), '''') IS NOT NULL
                AND tenant_id = current_setting(''app.current_tenant_id'', true)
              )
              OR (
                NULLIF(current_setting(''app.current_tenant_id'', true), '''') IS NULL
              )
            )
            WITH CHECK (
              current_setting(''app.bypass_rls'', true) = ''on''
              OR (
                NULLIF(current_setting(''app.current_tenant_id'', true), '''') IS NOT NULL
                AND tenant_id = current_setting(''app.current_tenant_id'', true)
              )
              OR (
                NULLIF(current_setting(''app.current_tenant_id'', true), '''') IS NULL
              )
            );
          ', tbl);
        END LOOP;
      END $$;
    `);
    console.log('[workflow-api] Migrations and RLS policies applied successfully.');
  } catch (err) {
    console.error('[workflow-api] Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
