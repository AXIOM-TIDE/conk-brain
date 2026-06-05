/**
 * Processor: cast_sounded / cast_indexed (SourceProvider interface)
 *
 * Called by the chain-agnostic poller for every new CastSounded/CastIndexed event.
 * Upserts the Cast and its Vessel, then fires synapse writers.
 */

import { pool } from '../../db/pool.js';
import { decodeHook } from '../sui-rpc.js';
import { KNOWN_VESSELS } from '../../config/index.js';
import { writeCoPublishSynapses, writeExplicitSynapsesFromHook } from '../synapse-writer.js';
import type { SourceEvent } from '../source-provider.js';

export async function processSoundEvent(event: SourceEvent): Promise<void> {
  const { payload, timestamp } = event;

  const castId   = String(payload.cast_id   || payload.object_id || '');
  const vesselId = String(payload.vessel_id || '');
  if (!castId || !vesselId) return;

  const hook      = decodeHook(payload.hook);
  const mode      = Number(payload.mode     ?? 0);
  const duration  = Number(payload.duration ?? 0);
  const soundedAt = timestamp.toISOString();
  // expires_at is not in SourceEvent payload — leave null; rollup enriches later
  const expiresAt = payload.expires_at
    ? new Date(Number(payload.expires_at)).toISOString()
    : null;
  const txDigest  = String(payload._txDigest || '');
  const isPaid    = mode !== 0;

  const known = KNOWN_VESSELS.find(v => v.vessel_id === vesselId);

  // Ensure vessel row exists with correct agent identity
  await pool.query(`
    INSERT INTO vessels (vessel_id, owner_address, agent_id, agent_name, first_sound_at, last_sound_at)
    VALUES ($1, COALESCE($2, 'unknown'), $3, $4, $5, $5)
    ON CONFLICT (vessel_id) DO UPDATE
    SET last_sound_at = EXCLUDED.last_sound_at,
        agent_id      = COALESCE(EXCLUDED.agent_id,   vessels.agent_id),
        agent_name    = COALESCE(EXCLUDED.agent_name, vessels.agent_name),
        cast_count    = vessels.cast_count + 1,
        updated_at    = NOW()
  `, [vesselId, known?.owner_wallet ?? null, known?.agent_id ?? null, known?.agent_name ?? null, soundedAt]);

  // Upsert cast
  await pool.query(`
    INSERT INTO casts (
      cast_id, vessel_id, hook, mode, duration, is_paid,
      sound_tx, sounded_at, expires_at, indexed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (cast_id) DO UPDATE
    SET hook       = COALESCE(EXCLUDED.hook,       casts.hook),
        mode       = EXCLUDED.mode,
        duration   = EXCLUDED.duration,
        is_paid    = EXCLUDED.is_paid,
        sound_tx   = COALESCE(EXCLUDED.sound_tx,   casts.sound_tx),
        sounded_at = COALESCE(EXCLUDED.sounded_at, casts.sounded_at),
        expires_at = COALESCE(EXCLUDED.expires_at, casts.expires_at),
        updated_at = NOW()
  `, [castId, vesselId, hook, mode, duration, isPaid, txDigest || null, soundedAt, expiresAt]);

  const label = known?.agent_name ?? vesselId.slice(0, 10);
  console.log(`[brain][cast-sounded] ${label} → cast ${castId.slice(0, 14)} mode=${mode} hook="${hook.slice(0, 60)}"`);

  // Wire synapses (non-blocking)
  writeCoPublishSynapses(castId, soundedAt).catch(() => {});
  if (hook) writeExplicitSynapsesFromHook(castId, hook).catch(() => {});
}
