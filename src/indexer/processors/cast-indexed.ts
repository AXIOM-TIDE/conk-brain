/**
 * Processor: drift::CastIndexed
 *
 * Emitted by drift.index_cast() in drift.move when a Cast enters the public feed.
 * This is the richest event for indexing — includes hook, vessel_tier, and timing.
 * Typically emitted in the same tx as CastSounded.
 *
 * On-chain event fields:
 *   cast_id:     address   — Cast object ID
 *   hook:        vector<u8>— public preview bytes
 *   vessel_tier: u8        — 0=GHOST, 1=SHADOW, 2=OPEN
 *   created_at:  u64       — ms timestamp
 *   expires_at:  u64       — ms timestamp
 *   mode:        u8        — cast mode
 */

import { pool } from '../../db/pool.js';
import { decodeHook, parseTimestamp } from '../sui-rpc.js';

export async function processCastIndexed(event: any): Promise<void> {
  const data = event.parsedJson as Record<string, unknown>;
  if (!data) return;

  const castId     = String(data.cast_id    || '');
  if (!castId) return;

  const hook       = decodeHook(data.hook);
  const vesselTier = Number(data.vessel_tier ?? 0);
  const mode       = Number(data.mode        ?? 0);
  const soundedAt  = parseTimestamp(data.created_at);
  const expiresAt  = parseTimestamp(data.expires_at);

  // Update cast record — set drift_indexed flag and enrich metadata
  // The cast row may already exist from CastSounded; this is an upsert-or-enrich.
  await pool.query(`
    INSERT INTO casts (
      cast_id, vessel_id, hook, mode, vessel_tier, drift_indexed,
      sounded_at, expires_at, indexed_at
    ) VALUES ($1, 'unknown', $2, $3, $4, true, $5, $6, NOW())
    ON CONFLICT (cast_id) DO UPDATE
    SET hook          = COALESCE(NULLIF(EXCLUDED.hook, ''), casts.hook),
        mode          = EXCLUDED.mode,
        vessel_tier   = EXCLUDED.vessel_tier,
        drift_indexed = true,
        sounded_at    = COALESCE(casts.sounded_at, EXCLUDED.sounded_at),
        expires_at    = COALESCE(casts.expires_at, EXCLUDED.expires_at),
        updated_at    = NOW()
  `, [castId, hook, mode, vesselTier, soundedAt, expiresAt]);

  console.log(`[brain][cast-indexed] drift indexed cast ${castId.slice(0, 14)} tier=${vesselTier} hook="${hook.slice(0, 60)}"`);
}
