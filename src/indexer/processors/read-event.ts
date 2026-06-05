/**
 * Processor: cast_read (SourceProvider interface)
 *
 * Called by the chain-agnostic poller for every CastRead event.
 * Records the read, updates cumulative read count, fires read synapse.
 */

import { pool } from '../../db/pool.js';
import { writeReadSynapse } from '../synapse-writer.js';
import type { SourceEvent } from '../source-provider.js';

export async function processReadEvent(event: SourceEvent): Promise<void> {
  const { payload, timestamp } = event;

  const castId    = String(payload.cast_id || '');
  const readCount = Number(payload.read_count ?? 0);
  const txDigest  = String(payload._txDigest || '');
  const eventSeq  = String(payload._eventSeq  || '');
  const readAt    = timestamp.toISOString();

  if (!castId || !txDigest) return;

  // Look up cast fee to infer revenue per read
  const { rows: castRows } = await pool.query<{ fee_usdc: string }>(
    'SELECT fee_usdc FROM casts WHERE cast_id = $1',
    [castId]
  );
  const feeUsdc = parseFloat(castRows[0]?.fee_usdc ?? '0');

  // Idempotent insert (unique on tx_digest)
  await pool.query(`
    INSERT INTO cast_reads (cast_id, read_count_at, revenue_usdc, tx_digest, event_seq, read_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tx_digest) DO NOTHING
  `, [castId, readCount, feeUsdc, txDigest, eventSeq, readAt]);

  // Keep cast.reads_all_time in sync
  await pool.query(`
    UPDATE casts
       SET reads_all_time = GREATEST(reads_all_time, $1),
           updated_at     = NOW()
     WHERE cast_id = $2
  `, [readCount, castId]);

  console.log(`[brain][cast-read] cast ${castId.slice(0, 14)} read #${readCount} tx=${txDigest.slice(0, 12)}`);

  // Fire read synapse (non-blocking — errors logged, never crash indexing)
  writeReadSynapse(castId, txDigest).catch(() => {});
}
