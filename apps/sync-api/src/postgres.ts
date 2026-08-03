import { Pool } from 'pg';

import { PostgresSyncStore } from './postgres-store.js';

export type PostgresRuntime = {
  pool: Pool;
  store: PostgresSyncStore;
  close(): Promise<void>;
};

export function createPostgresRuntime(
  connectionString = process.env.DATABASE_URL,
): PostgresRuntime {
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL persistence');

  const pool = new Pool({
    connectionString,
    max: Number(process.env.GOSU_POSTGRES_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'gosu-sync-api',
    ssl: process.env.GOSU_POSTGRES_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
  });

  return {
    pool,
    store: new PostgresSyncStore(pool),
    close: () => pool.end(),
  };
}
