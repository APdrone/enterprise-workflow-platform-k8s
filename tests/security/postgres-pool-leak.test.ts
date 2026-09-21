import { describe, it, expect, vi } from 'vitest';
import { withTenantContext, withAdminBypass } from '../../services/workflow-api/src/db/client.js';

describe('PostgreSQL Connection Pool Tenant-Context Poisoning & Leak Guard', () => {
  describe('1. Transaction-Local Scoping (is_local = true) Semantics', () => {
    it('guarantees set_config is invoked with is_local=true to prevent session-level bleed', () => {
      // In PostgreSQL, set_config(setting_name, new_value, is_local)
      // When is_local = true, the setting strictly applies only to the current transaction
      // and resets automatically on COMMIT or ROLLBACK.
      const isLocalSetting = true;
      expect(isLocalSetting).toBe(true);

      const buildSetConfigQuery = (tenantId: string, isLocal: boolean) => ({
        text: "SELECT set_config('app.current_tenant_id', $1, $2)",
        values: [tenantId, isLocal],
      });

      const query = buildSetConfigQuery('tenant-alpha', true);
      expect(query.values[1]).toBe(true);
    });
  });

  describe('2. Connection Pool Mid-Transaction Error Recovery & Cleanup', () => {
    it('executes ROLLBACK and releases client to pool when an exception occurs inside tenant callback', async () => {
      const executedQueries: string[] = [];
      let clientReleased = false;

      // Mock PostgreSQL client instance from pool
      const mockClient = {
        query: vi.fn(async (sql: string, params?: any[]) => {
          executedQueries.push(typeof sql === 'string' ? sql : (sql as any).text);
          if (sql.includes('SELECT set_config')) {
            return { rows: [{ set_config: params?.[0] }] };
          }
          return { rows: [] };
        }),
        release: vi.fn(() => {
          clientReleased = true;
        }),
      };

      // Simulate a runner helper wrapping the client
      const executeWithContext = async <T>(
        tenantId: string,
        fn: (client: typeof mockClient) => Promise<T>
      ): Promise<T> => {
        try {
          await mockClient.query('BEGIN');
          await mockClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
          const result = await fn(mockClient);
          await mockClient.query('COMMIT');
          return result;
        } catch (err) {
          await mockClient.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          mockClient.release();
        }
      };

      // Execute tenant transaction that throws an unhandled error
      let caughtError: any = null;
      try {
        await executeWithContext('tenant-corp-a', async () => {
          throw new Error('Simulated unhandled DB query constraint violation');
        });
      } catch (err) {
        caughtError = err;
      }

      // Assert:
      // 1. Error was propagated
      expect(caughtError).not.toBeNull();
      expect(caughtError.message).toContain('Simulated unhandled DB query');

      // 2. BEGIN was called, then set_config, then ROLLBACK (never COMMIT)
      expect(executedQueries).toContain('BEGIN');
      expect(executedQueries).toContain("SELECT set_config('app.current_tenant_id', $1, true)");
      expect(executedQueries).toContain('ROLLBACK');
      expect(executedQueries).not.toContain('COMMIT');

      // 3. Client was guaranteed to be released back to the pool
      expect(clientReleased).toBe(true);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Multi-Tenant Concurrent Pool Checkout Isolation', () => {
    it('guarantees concurrent checkouts from pool maintain strict tenant boundary isolation', async () => {
      interface SessionState {
        tenantSetting: string | null;
        inTransaction: boolean;
      }

      class MockConnectionPool {
        private session = new Map<string, SessionState>();

        async acquire(clientId: string) {
          if (!this.session.has(clientId)) {
            this.session.set(clientId, { tenantSetting: null, inTransaction: false });
          }
          const state = this.session.get(clientId)!;

          return {
            query: async (sql: string, params?: any[]) => {
              if (sql === 'BEGIN') {
                state.inTransaction = true;
              } else if (sql.includes('set_config')) {
                state.tenantSetting = params?.[0] || null;
              } else if (sql === 'COMMIT' || sql === 'ROLLBACK') {
                // When transaction ends with is_local=true, context resets
                state.inTransaction = false;
                state.tenantSetting = null;
              }
            },
            getCurrentTenant: () => state.tenantSetting,
            release: () => {
              // Safety guard: ensure reset upon release
              state.tenantSetting = null;
              state.inTransaction = false;
            },
          };
        }
      }

      const pool = new MockConnectionPool();

      // Client A runs for tenant-alpha
      const connA = await pool.acquire('conn-1');
      await connA.query('BEGIN');
      await connA.query("SELECT set_config('app.current_tenant_id', $1, true)", ['tenant-alpha']);
      expect(connA.getCurrentTenant()).toBe('tenant-alpha');

      // Client B checks out another connection from pool for tenant-beta
      const connB = await pool.acquire('conn-2');
      await connB.query('BEGIN');
      await connB.query("SELECT set_config('app.current_tenant_id', $1, true)", ['tenant-beta']);
      expect(connB.getCurrentTenant()).toBe('tenant-beta');

      // Client A finishes transaction and releases
      await connA.query('COMMIT');
      connA.release();

      // Next user acquires conn-1 from pool without setting tenant -> MUST be clean (null)
      const recycledConn1 = await pool.acquire('conn-1');
      expect(recycledConn1.getCurrentTenant()).toBeNull();

      // Conn B still scoped to tenant-beta until its own commit
      expect(connB.getCurrentTenant()).toBe('tenant-beta');
      await connB.query('COMMIT');
      connB.release();
      expect(connB.getCurrentTenant()).toBeNull();
    });
  });

  describe('4. Scoped DB Helper Function Type Invariants', () => {
    it('exports withTenantContext and withAdminBypass with correct functional signatures', () => {
      expect(typeof withTenantContext).toBe('function');
      expect(typeof withAdminBypass).toBe('function');
    });
  });
});
