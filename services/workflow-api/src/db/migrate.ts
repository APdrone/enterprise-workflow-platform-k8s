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
    `);
    console.log('[workflow-api] Migrations completed successfully.');
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
