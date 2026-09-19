import { pool } from './client.js';

export async function runAuditMigrations() {
  const client = await pool.connect();
  try {
    console.log('[audit-service] Running audit database migrations...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id VARCHAR(64) PRIMARY KEY,
        workflow_id VARCHAR(64) NOT NULL,
        tenant_id VARCHAR(64) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        actor_id VARCHAR(64) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_workflow_tenant ON audit_events(tenant_id, workflow_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
    `);
    console.log('[audit-service] Audit migrations completed successfully.');
  } catch (err) {
    console.error('[audit-service] Audit migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runAuditMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
