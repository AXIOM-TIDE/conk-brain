import { pool } from './pool.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('[brain][migrate] Schema applied ✓');
  } catch (err: any) {
    // pgvector extension might not be available on all Railway Postgres plans.
    // If extension fails, re-run without the vector extension line.
    if (err.message?.includes('could not open extension control file') ||
        err.message?.includes('extension "vector" does not exist')) {
      console.warn('[brain][migrate] pgvector not available — semantic search disabled');
      const sqlNoVector = sql
        .replace(/CREATE EXTENSION IF NOT EXISTS vector;/g, '-- pgvector not available')
        .replace(/embedding\s+vector\(1536\),/g, '-- embedding vector(1536),  -- pgvector not available')
        .replace(/CREATE INDEX IF NOT EXISTS idx_casts_embedding.+;/g, '');
      await client.query(sqlNoVector);
      console.log('[brain][migrate] Schema applied (no pgvector) ✓');
    } else {
      throw err;
    }
  } finally {
    client.release();
  }
}
