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

      CREATE TABLE IF NOT EXISTS dlq_messages (
        id VARCHAR(64) PRIMARY KEY,
        original_topic VARCHAR(128) NOT NULL,
        original_key VARCHAR(128),
        payload JSONB NOT NULL,
        error_type VARCHAR(64) NOT NULL,
        error_message TEXT NOT NULL,
        retry_count INT NOT NULL DEFAULT 0,
        tenant_id VARCHAR(64),
        workflow_id VARCHAR(64),
        headers JSONB,
        status VARCHAR(32) NOT NULL DEFAULT 'DEAD_LETTERED',
        failed_at TIMESTAMPTZ NOT NULL,
        replayed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_dlq_status ON dlq_messages(status);
      CREATE INDEX IF NOT EXISTS idx_dlq_tenant ON dlq_messages(tenant_id);

      -- Row-Level Security (RLS) Hardening
      DO $$
      DECLARE
        tbl TEXT;
        tables TEXT[] := ARRAY['audit_events', 'dlq_messages'];
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
    console.log('[audit-service] Audit migrations and RLS policies completed successfully.');
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
