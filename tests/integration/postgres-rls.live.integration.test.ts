import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isDockerAvailable, startTestPostgres } from '@workflow/test-utils';
import pg from 'pg';

describe('Live PostgreSQL Row-Level Security (RLS) & Migration Engine Tests', async () => {
  const dockerRunning = await isDockerAvailable();

  describe.skipIf(!dockerRunning)('Live Database RLS Enforcement Matrix', () => {
    let pool: pg.Pool;
    let stopContainer: () => Promise<void>;

    beforeAll(async () => {
      const res = await startTestPostgres();
      pool = res.pool;
      stopContainer = res.stop;

      // 1. Initialize schema and RLS policies
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflows (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          type VARCHAR(64) NOT NULL,
          title VARCHAR(255) NOT NULL,
          amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
          currency VARCHAR(3) NOT NULL DEFAULT 'USD',
          requester_id VARCHAR(64) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Enable and Force RLS
        ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
        ALTER TABLE workflows FORCE ROW LEVEL SECURITY;

        -- Create RLS Isolation Policy with WITH CHECK constraint
        DROP POLICY IF EXISTS workflow_tenant_isolation_policy ON workflows;
        CREATE POLICY workflow_tenant_isolation_policy ON workflows
          AS PERMISSIVE
          FOR ALL
          TO PUBLIC
          USING (
            current_setting('app.bypass_rls', true) = 'on'
            OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
          )
          WITH CHECK (
            current_setting('app.bypass_rls', true) = 'on'
            OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')
          );
      `);
    }, 60000);

    afterAll(async () => {
      if (stopContainer) {
        await stopContainer();
      }
    });

    it('isolates data at SQL engine level: tenant-alpha cannot query tenant-beta workflows', async () => {
      const client = await pool.connect();
      try {
        // Insert as Tenant Alpha within Alpha tenant context
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant_id', 'tenant-alpha', true)");
        await client.query(`
          INSERT INTO workflows (id, tenant_id, type, title, amount, requester_id, status)
          VALUES ('wf-alpha-1', 'tenant-alpha', 'EXPENSE', 'Alpha Secret Budget', 10000, 'user-a', 'DRAFT')
        `);
        await client.query('COMMIT');

        // Insert as Tenant Beta within Beta tenant context
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant_id', 'tenant-beta', true)");
        await client.query(`
          INSERT INTO workflows (id, tenant_id, type, title, amount, requester_id, status)
          VALUES ('wf-beta-1', 'tenant-beta', 'EXPENSE', 'Beta Secret Budget', 20000, 'user-b', 'DRAFT')
        `);
        await client.query('COMMIT');

        // Query as Tenant Alpha -> must strictly receive ONLY Alpha records
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant_id', 'tenant-alpha', true)");
        const alphaResult = await client.query('SELECT * FROM workflows');
        await client.query('COMMIT');

        expect(alphaResult.rows).toHaveLength(1);
        expect(alphaResult.rows[0].id).toBe('wf-alpha-1');
        expect(alphaResult.rows[0].tenant_id).toBe('tenant-alpha');

        // Query as Tenant Beta -> must strictly receive ONLY Beta records
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant_id', 'tenant-beta', true)");
        const betaResult = await client.query('SELECT * FROM workflows');
        await client.query('COMMIT');

        expect(betaResult.rows).toHaveLength(1);
        expect(betaResult.rows[0].id).toBe('wf-beta-1');
        expect(betaResult.rows[0].tenant_id).toBe('tenant-beta');
      } finally {
        client.release();
      }
    });

    it('enforces WITH CHECK constraint: blocks unauthorized cross-tenant INSERT at PostgreSQL engine level', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Set context to tenant-alpha
        await client.query("SELECT set_config('app.current_tenant_id', 'tenant-alpha', true)");

        // Attempt to insert a row belonging to tenant-beta while scoped to tenant-alpha
        let rlsError: any = null;
        try {
          await client.query(`
            INSERT INTO workflows (id, tenant_id, type, title, amount, requester_id, status)
            VALUES ('wf-cross-write', 'tenant-beta', 'EXPENSE', 'Illegal Cross-Tenant Write', 9999, 'attacker', 'DRAFT')
          `);
        } catch (err) {
          rlsError = err;
        } finally {
          await client.query('ROLLBACK');
        }

        // PostgreSQL must reject with RLS policy violation (SQLSTATE 42501)
        expect(rlsError).not.toBeNull();
        expect(rlsError.message).toContain('row-level security policy');
      } finally {
        client.release();
      }
    });

    it('allows superadmin bypass mode when app.bypass_rls = on', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
        const allRows = await client.query('SELECT * FROM workflows');
        await client.query('COMMIT');

        expect(allRows.rows.length).toBeGreaterThanOrEqual(2);
        const tenantIds = allRows.rows.map((r) => r.tenant_id);
        expect(tenantIds).toContain('tenant-alpha');
        expect(tenantIds).toContain('tenant-beta');
      } finally {
        client.release();
      }
    });
  });

  if (!dockerRunning) {
    it.skip('Live PostgreSQL RLS tests (Docker daemon not running in current environment)', () => {});
  }
});
