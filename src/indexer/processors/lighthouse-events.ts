/**
 * Processors for Lighthouse events:
 *
 * cast::LighthouseBorn — emitted when a Cast achieves Lighthouse status
 *   Fields: cast_id, birth_path (u8), read_count (u64), born_at (u64)
 *   birth_path: 1 = LH_PATH_MILLION (1M reads in 24h), 2 = LH_PATH_TIDES (3×tides)
 *
 * drift::LighthouseIndexed — emitted when Drift registers the Lighthouse
 *   Fields: cast_id, lighthouse_id, birth_path, born_at
 */

import { pool } from '../../db/pool.js';
import { parseTimestamp } from '../sui-rpc.js';

const BIRTH_PATH_LABELS: Record<number, string> = {
  1: 'million_reads_24h',
  2: 'three_tides',
};

export async function processLighthouseBorn(event: any): Promise<void> {
  const data = event.parsedJson as Record<string, unknown>;
  if (!data) return;

  const castId     = String(data.cast_id    || '');
  const birthPath  = Number(data.birth_path ?? 0);
  const readCount  = Number(data.read_count ?? 0);
  const bornAt     = parseTimestamp(data.born_at);

  if (!castId) return;

  // Mark cast as lighthouse
  await pool.query(`
    UPDATE casts
    SET is_lighthouse  = true,
        lighthouse_path = $2,
        lighthouse_id   = cast_id,
        reads_all_time  = GREATEST(reads_all_time, $3),
        updated_at      = NOW()
    WHERE cast_id = $1
  `, [castId, birthPath, readCount]);

  // Upsert lighthouse record
  await pool.query(`
    INSERT INTO lighthouses (lighthouse_id, cast_id, birth_path, read_count_at_birth, born_at)
    VALUES ($1, $1, $2, $3, $4)
    ON CONFLICT (lighthouse_id) DO UPDATE
    SET birth_path = EXCLUDED.birth_path,
        born_at    = EXCLUDED.born_at
  `, [castId, birthPath, readCount, bornAt]);

  const pathLabel = BIRTH_PATH_LABELS[birthPath] ?? `path_${birthPath}`;
  console.log(`[brain][lighthouse-born] cast ${castId.slice(0, 14)} → LIGHTHOUSE via ${pathLabel} at ${readCount} reads`);
}

export async function processLighthouseIndexed(event: any): Promise<void> {
  const data = event.parsedJson as Record<string, unknown>;
  if (!data) return;

  const castId       = String(data.cast_id       || '');
  const lighthouseId = String(data.lighthouse_id || castId);
  const birthPath    = Number(data.birth_path    ?? 0);
  const bornAt       = parseTimestamp(data.born_at);

  if (!castId) return;

  // Update the cast with lighthouse association
  await pool.query(`
    UPDATE casts
    SET is_lighthouse   = true,
        lighthouse_id   = $2,
        lighthouse_path = $3,
        updated_at      = NOW()
    WHERE cast_id = $1
  `, [castId, lighthouseId, birthPath]);

  // Upsert into lighthouses table
  await pool.query(`
    INSERT INTO lighthouses (lighthouse_id, cast_id, birth_path, born_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (lighthouse_id) DO NOTHING
  `, [lighthouseId, castId, birthPath, bornAt]);

  console.log(`[brain][lighthouse-indexed] drift registered lighthouse ${lighthouseId.slice(0, 14)}`);
}
