import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;

const host = process.env.POSTGRES_HOST || '127.0.0.1';
const port = process.env.POSTGRES_PORT || '5433';
const user = process.env.POSTGRES_USER || 'postgres';
const password = process.env.POSTGRES_PASSWORD || 'postgres';
const database = process.env.POSTGRES_DB || 'workflow_db';

const connectionString =
  process.env.DATABASE_URL || `postgresql://${user}:${password}@${host}:${port}/${database}`;

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });
