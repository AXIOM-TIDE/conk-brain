import { pool } from '../db/pool.js';

export async function getWatermark(key: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT last_cursor FROM sync_cursors WHERE event_type = $1', [key]);
  return rows[0]?.last_cursor ?? null;
}

export async function setWatermark(key: string, cursor: string, count: number): Promise<void> {
  await pool.query(`
    INSERT INTO sync_cursors (event_type, last_cursor, last_synced, total_events)
    VALUES ($1, $2, NOW(), $3)
    ON CONFLICT (event_type) DO UPDATE
    SET last_cursor = $2, last_synced = NOW(), total_events = sync_cursors.total_events + $3
  `, [key, cursor, count]);
}

/**
 * Get all sync cursor status for health/stats endpoint.
 */
export async function getAllWatermarks() {
  const { rows } = await pool.query(`
    SELECT event_type, last_cursor, last_synced, total_events
    FROM sync_cursors
    ORDER BY last_synced DESC NULLS LAST
  `);
  return rows;
}
