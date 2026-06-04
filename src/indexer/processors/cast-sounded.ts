/**
 * Processor: cast::CastSounded
 *
 * Emitted by sound() in cast.move when a new Cast is published.
 *
 * On-chain event fields:
 *   cast_id:    address   — Sui object ID of the new Cast
 *   vessel_id:  address   — Vessel that published it (v11+)
 *   hook:       vector<u8>— public preview bytes (decoded to UTF-8)
 *   mode:       u8        — 0=OPEN, 1=SHADOW, 2=GHOST, 3=SEALED, 4=EYES_ONLY
 *   duration:   u8        — cast duration type
 *   created_at: u64       — ms timestamp
 *   expires_at: u64       — ms timestamp
 *
 * NOTE: fee_paid is NOT in the event — it's on the Cast object. We leave
 * fee_usdc = 0 initially; the rollup job can enrich it from on-chain state.
 */

import { pool } from '../../db/pool.js';
import { decodeHook, parseTimestamp } from '../sui-rpc.js';
import { KNOWN_VESSELS } from '../../config/index.js';
import { writeCoPublishSynapses, writeExplicitSynapsesFromHook } from '../synapse-writer.js';

export async function processCastSounded(event: any): Promise<void> {
  const data = event.parsedJson as Record<string, unknown>;
  if (!data) return;

  const castId   = String(data.cast_id   || '');
  const vesselId = String(data.vessel_id || '');
  if (!castId || !vesselId) {
    console.warn('[brain][cast-sounded] missing cast_id or vessel_id, skipping');
    return;
  }

  const hook      = decodeHook(data.hook);
  const mode      = Number(data.mode      ?? 0);
  const duration  = Number(data.duration  ?? 0);
  const soundedAt = parseTimestamp(data.created_at);
  const expiresAt = parseTimestamp(data.expires_at);
  const txDigest  = event.id?.txDigest as string | undefined;
  const isPaid    = mode !== 0; // OPEN mode = free; all others = paid

  const known = KNOWN_VESSELS.find(v => v.vessel_id === vesselId);

  // ── Ensure vessel row exists ──────────────────────────────────────────────
  await pool.query(`
    INSERT INTO vessels (vessel_id, owner_address, agent_id, agent_name, first_sound_at, last_sound_at)
    VALUES ($1, 'unknown', $2, $3, $4, $4)
    ON CONFLICT (vessel_id) DO UPDATE
    SET last_sound_at = EXCLUDED.last_sound_at,
        updated_at    = NOW()
  `, [vesselId, known?.agent_id ?? null, known?.agent_name ?? null, soundedAt]);

  // ── Upsert cast ───────────────────────────────────────────────────────────
  await pool.query(`
    INSERT INTO casts (
      cast_id, vessel_id, hook, mode, duration, is_paid,
      sound_tx, sounded_at, expires_at, indexed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (cast_id) DO UPDATE
    SET hook       = COALESCE(EXCLUDED.hook, casts.hook),
        mode       = EXCLUDED.mode,
        duration   = EXCLUDED.duration,
        is_paid    = EXCLUDED.is_paid,
        sound_tx   = COALESCE(EXCLUDED.sound_tx, casts.sound_tx),
        sounded_at = COALESCE(EXCLUDED.sounded_at, casts.sounded_at),
        expires_at = COALESCE(EXCLUDED.expires_at, casts.expires_at),
        updated_at = NOW()
  `, [castId, vesselId, hook, mode, duration, isPaid, txDigest ?? null, soundedAt, expiresAt]);

  const agentLabel = known?.agent_name ?? vesselId.slice(0, 10);
  console.log(`[brain][cast-sounded] ${agentLabel} → cast ${castId.slice(0, 14)} mode=${mode} hook="${hook.slice(0, 60)}"`);

  // Wire synapses (non-blocking — a synapse miss never kills indexing)
  if (soundedAt) {
    writeCoPublishSynapses(castId, soundedAt).catch(() => {});
  }
  if (hook) {
    writeExplicitSynapsesFromHook(castId, hook).catch(() => {});
  }
}
