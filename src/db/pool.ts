import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('[brain] WARNING: DATABASE_URL not set — DB operations will fail');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // DATABASE_SSL=false for internal Railway Postgres (no SSL on Docker pgvector image).
  // Managed Railway Postgres or external DBs may need ssl: { rejectUnauthorized: false }.
  ssl: process.env.DATABASE_SSL === 'false' ? false
     : process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[brain][db] Unexpected pool error:', err.message);
});
