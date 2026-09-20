import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { instrumentPgPool } from '@workflow/telemetry';

const { Pool } = pg;

const host = process.env.POSTGRES_HOST || '127.0.0.1';
const port = process.env.POSTGRES_PORT || '5433';
const user = process.env.POSTGRES_USER || 'postgres';
const password = process.env.POSTGRES_PASSWORD || 'postgres';
const database = process.env.POSTGRES_AUDIT_DB || process.env.POSTGRES_DB || 'audit_db';

const connectionString =
  process.env.AUDIT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  `postgresql://${user}:${password}@${host}:${port}/${database}`;

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

instrumentPgPool(pool, { serviceName: 'audit-service', dbName: database });

export const db = drizzle(pool, { schema });

export async function withTenantContext<T>(
  tenantId: string,
  fn: (txDb: any) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const scopedDb = drizzle(client, { schema });
    const result = await fn(scopedDb);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function withAdminBypass<T>(
  fn: (txDb: any) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
    const scopedDb = drizzle(client, { schema });
    const result = await fn(scopedDb);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
