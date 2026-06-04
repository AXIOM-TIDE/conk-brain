import { pool } from '../db/pool.js';
import type { SuiCursor } from './sui-rpc.js';

/**
 * Get the last processed cursor for an event type.
 * Returns null if this event type has never been synced.
 */
export async function getWatermark(eventType: string): Promise<SuiCursor | null> {
  const { rows } = await pool.query<{ last_cursor: SuiCursor | null }>(
    'SELECT last_cursor FROM sync_cursors WHERE event_type = $1',
    [eventType]
  );
  return rows[0]?.last_cursor ?? null;
}

/**
 * Persist the new watermark cursor after a successful sync batch.
 */
export async function setWatermark(
  eventType: string,
  cursor: SuiCursor,
  batchCount: number
): Promise<void> {
  await pool.query(`
    INSERT INTO sync_cursors (event_type, last_cursor, last_synced, total_events)
    VALUES ($1, $2::jsonb, NOW(), $3)
    ON CONFLICT (event_type) DO UPDATE
    SET last_cursor  = EXCLUDED.last_cursor,
        last_synced  = NOW(),
        total_events = sync_cursors.total_events + EXCLUDED.total_events
  `, [eventType, JSON.stringify(cursor), batchCount]);
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
