/**
 * Synapse Writer
 *
 * Creates directed edges in the knowledge graph (synapses table).
 * An edge represents a meaningful relationship between two Casts.
 *
 * Types:
 *   'read'       — reader's vessel published a cast that led to reading another cast
 *   'co_publish' — two vessels published within the same daily batch (weak signal)
 *   'explicit'   — declared in cast hook/content (future: on-chain synapse refs)
 *
 * Schema: synapses(from_cast_id, to_cast_id, weight, synapse_type, created_by)
 * Constraint: UNIQUE(from_cast_id, to_cast_id) — upsert on conflict, bump weight.
 */

import { pool } from '../db/pool.js';
import { suiClient } from './sui-rpc.js';

// ─── Read-edge synapse ────────────────────────────────────────────────────────
// Called after a CastRead event. Enriches cast_reads with reader address,
// finds the reader's vessel, finds their most recent published cast,
// and writes a synapse: reader_last_cast → read_cast (type='read').
//
// If the reader has no published casts, no synapse is created (graph stays
// honest — only cast-to-cast edges, no dangling vessel refs).

export async function writeReadSynapse(castId: string, txDigest: string): Promise<void> {
  try {
    // 1. Fetch the transaction to get the sender (reader) address
    const tx = await suiClient.getTransactionBlock({
      digest: txDigest,
      options: { showInput: true },
    });
    const senderAddress: string | undefined =
      (tx?.transaction?.data as any)?.sender;

    if (!senderAddress) {
      console.warn(`[brain][synapse] no sender in tx ${txDigest.slice(0, 12)}`);
      return;
    }

    // 2. Update cast_reads with reader address (enrichment)
    await pool.query(
      `UPDATE cast_reads SET reader_address = $1 WHERE tx_digest = $2`,
      [senderAddress, txDigest]
    );

    // 3. Find the reader's vessel (vessel owner_address matches sender)
    const { rows: vesselRows } = await pool.query<{ vessel_id: string }>(
      `SELECT vessel_id FROM vessels WHERE owner_address = $1 LIMIT 1`,
      [senderAddress]
    );
    if (!vesselRows.length) {
      // Reader isn't a known vessel — no edge to draw
      return;
    }
    const readerVesselId = vesselRows[0].vessel_id;

    // 4. Find the reader's most recently published cast (their "voice" in the graph)
    const { rows: fromCastRows } = await pool.query<{ cast_id: string }>(
      `SELECT cast_id FROM casts WHERE vessel_id = $1
       ORDER BY sounded_at DESC NULLS LAST LIMIT 1`,
      [readerVesselId]
    );
    if (!fromCastRows.length) {
      // Reader vessel exists but has published nothing — no edge yet
      return;
    }
    const fromCastId = fromCastRows[0].cast_id;

    // Don't self-loop
    if (fromCastId === castId) return;

    // 5. Upsert synapse (bump weight on repeat reads — each re-read strengthens the edge)
    await upsertSynapse(fromCastId, castId, 1.0, 'read', readerVesselId);

    console.log(`[brain][synapse] read edge: ${fromCastId.slice(0, 10)} → ${castId.slice(0, 10)} (reader=${readerVesselId.slice(0, 10)})`);
  } catch (err: any) {
    // Non-fatal — log and continue. A missing synapse is recoverable; a crashed processor is not.
    console.warn(`[brain][synapse] writeReadSynapse failed for cast ${castId.slice(0, 14)}: ${err.message}`);
  }
}

// ─── Co-publish synapse ───────────────────────────────────────────────────────
// When a new cast is published, create weak co-publish edges to other casts
// published by different vessels within the same ±6-hour window.
// Weight = 0.3 (weak signal; read edges are 1.0+).
// This seeds the graph before any reads happen.

export async function writeCoPublishSynapses(newCastId: string, soundedAt: string): Promise<void> {
  try {
    const { rows } = await pool.query<{ cast_id: string; vessel_id: string }>(
      `SELECT c.cast_id, c.vessel_id
         FROM casts c
         JOIN casts nc ON nc.cast_id = $1
        WHERE c.cast_id <> $1
          AND c.vessel_id <> nc.vessel_id
          AND c.sounded_at BETWEEN ($2::timestamptz - INTERVAL '6 hours')
                                AND ($2::timestamptz + INTERVAL '6 hours')
        ORDER BY ABS(EXTRACT(EPOCH FROM (c.sounded_at - $2::timestamptz)))
        LIMIT 10`,
      [newCastId, soundedAt]
    );

    for (const peer of rows) {
      // Bidirectional weak edge — both casts co-existed in the same publish window
      await upsertSynapse(newCastId, peer.cast_id, 0.3, 'co_publish', 'brain');
      await upsertSynapse(peer.cast_id, newCastId, 0.3, 'co_publish', 'brain');
    }

    if (rows.length > 0) {
      console.log(`[brain][synapse] co_publish: ${newCastId.slice(0, 10)} ↔ ${rows.length} peers`);
    }
  } catch (err: any) {
    console.warn(`[brain][synapse] writeCoPublishSynapses failed for ${newCastId.slice(0, 14)}: ${err.message}`);
  }
}

// ─── Explicit synapse from hook ───────────────────────────────────────────────
// If the hook text contains a bare Sui address (0x..., 64 hex chars after 0x),
// treat it as an explicit reference to another cast and wire the edge.
// Weight = 2.0 — explicit is the strongest signal.

export async function writeExplicitSynapsesFromHook(
  fromCastId: string,
  hook: string
): Promise<void> {
  try {
    // Match 0x followed by 62-64 hex chars (Sui object IDs)
    const matches = hook.match(/0x[0-9a-fA-F]{62,64}/g) ?? [];
    const unique = [...new Set(matches)].filter(id => id !== fromCastId);

    for (const refId of unique) {
      // Only create edge if the target cast actually exists in our index
      const { rows } = await pool.query(
        `SELECT 1 FROM casts WHERE cast_id = $1 LIMIT 1`,
        [refId]
      );
      if (!rows.length) continue;

      await upsertSynapse(fromCastId, refId, 2.0, 'explicit', 'brain');
      console.log(`[brain][synapse] explicit ref: ${fromCastId.slice(0, 10)} → ${refId.slice(0, 10)}`);
    }
  } catch (err: any) {
    console.warn(`[brain][synapse] writeExplicitSynapsesFromHook failed: ${err.message}`);
  }
}

// ─── Core upsert ─────────────────────────────────────────────────────────────

async function upsertSynapse(
  fromCastId: string,
  toCastId: string,
  weight: number,
  type: string,
  createdBy: string
): Promise<void> {
  await pool.query(`
    INSERT INTO synapses (from_cast_id, to_cast_id, weight, synapse_type, created_by)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (from_cast_id, to_cast_id)
    DO UPDATE SET
      weight      = LEAST(synapses.weight + EXCLUDED.weight, 10.0),
      synapse_type = CASE
        WHEN synapses.synapse_type = 'explicit' THEN 'explicit'
        WHEN EXCLUDED.synapse_type = 'explicit' THEN 'explicit'
        WHEN synapses.synapse_type = 'read'     THEN 'read'
        WHEN EXCLUDED.synapse_type = 'read'     THEN 'read'
        ELSE EXCLUDED.synapse_type
      END,
      created_at  = synapses.created_at  -- preserve original creation time
  `, [fromCastId, toCastId, weight, type, createdBy]);

  // Keep synapse_count on both casts in sync
  await pool.query(`
    UPDATE casts SET synapse_count = (
      SELECT COUNT(*) FROM synapses
       WHERE from_cast_id = $1 OR to_cast_id = $1
    ) WHERE cast_id = $1
  `, [fromCastId]);
  await pool.query(`
    UPDATE casts SET synapse_count = (
      SELECT COUNT(*) FROM synapses
       WHERE from_cast_id = $1 OR to_cast_id = $1
    ) WHERE cast_id = $1
  `, [toCastId]);

  // Update network_stats.total_synapses
  await pool.query(`
    UPDATE network_stats SET total_synapses = (SELECT COUNT(*) FROM synapses), last_updated = NOW()
     WHERE id = 1
  `);
}
