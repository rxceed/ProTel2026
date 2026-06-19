import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '@/config';
import { logger } from '@/shared/utils/logger.util';
import * as schema from './schema';

// ---------------------------------------------------------------------------
// PostgreSQL connection pool
// ---------------------------------------------------------------------------
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  min: config.DB_POOL_MIN,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Tambahkan SSL untuk Railway production
  ...(config.NODE_ENV === 'production' && {
    ssl: { rejectUnauthorized: false },
  }),
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

pool.on('connect', () => {
  logger.debug('New client connected to PostgreSQL pool');
});

// ---------------------------------------------------------------------------
// Drizzle ORM instance
// ---------------------------------------------------------------------------
export const db = drizzle(pool, {
  schema,
  logger: config.NODE_ENV === 'development',
});

// ---------------------------------------------------------------------------
// Test connection — dipanggil saat server startup
// ---------------------------------------------------------------------------
export async function testConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ db: string; version: string }>(
      "SELECT current_database() as db, version() as version",
    );
    logger.info(
      {
        database: result.rows[0]?.db,
        version: result.rows[0]?.version?.split(' ').slice(0, 2).join(' '),
      },
      '✓ Database connected',
    );
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown — panggil saat SIGTERM
// ---------------------------------------------------------------------------
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('Database pool closed');
}

export type DbClient = typeof db;
