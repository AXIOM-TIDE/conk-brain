/**
 * Synapse Backfill
 *
 * Runs once on startup to seed synapses for existing casts/reads.
 * Idempotent — safe to run multiple times (upsert logic handles dupes).
 *
 * Two passes:
 *  1. Co-publish synapses: for each cast, find peers in the same ±6h window
 *  2. Read synapses: for each cast_read with a tx_digest, enrich reader + wire edge
 */

import { pool } from '../db/pool.js';
import { writeCoPublishSynapses, writeReadSynapse } from './synapse-writer.js';

export async function runSynapseBackfill(): Promise<void> {
  console.log('[brain][backfill] Starting synapse backfill...');

  // Pass 1: co-publish synapses for all existing casts
  const { rows: allCasts } = await pool.query<{ cast_id: string; sounded_at: string }>(
    `SELECT cast_id, sounded_at FROM casts WHERE sounded_at IS NOT NULL ORDER BY sounded_at`
  );

  let coPublishCount = 0;
  for (const cast of allCasts) {
    await writeCoPublishSynapses(cast.cast_id, cast.sounded_at);
    coPublishCount++;
  }
  console.log(`[brain][backfill] Co-publish pass done: ${coPublishCount} casts processed`);

  // Pass 2: read synapses for all existing cast_reads that have a tx_digest
  const { rows: allReads } = await pool.query<{ cast_id: string; tx_digest: string }>(
    `SELECT cast_id, tx_digest FROM cast_reads WHERE tx_digest IS NOT NULL ORDER BY read_at`
  );

  let readEdgeCount = 0;
  for (const read of allReads) {
    await writeReadSynapse(read.cast_id, read.tx_digest);
    readEdgeCount++;
  }
  console.log(`[brain][backfill] Read-edge pass done: ${readEdgeCount} reads enriched`);

  const { rows: stats } = await pool.query(`SELECT COUNT(*) AS total FROM synapses`);
  console.log(`[brain][backfill] Backfill complete. Total synapses: ${stats[0]?.total ?? 0}`);
}
