/**
 * Processor: cast::CastRead
 *
 * Emitted by read() in cast.move when a Cast is read.
 *
 * On-chain event fields:
 *   cast_id:    address — Cast that was read
 *   read_count: u64    — cumulative read count at time of event
 *   read_at:    u64    — ms timestamp
 *
 * IMPORTANT: The CastRead event does NOT include:
 *   - reader wallet address (sender is in the tx, not the event)
 *   - fee amount paid (it's on the Cast object, not the event)
 *
 * Revenue is inferred: each read earns the author cast.fee_usdc.
 * We look up fee_usdc from our DB to track revenue per read.
 */

import { pool } from '../../db/pool.js';
import { parseTimestamp } from '../sui-rpc.js';
import { writeReadSynapse } from '../synapse-writer.js';

export async function processCastRead(event: any): Promise<void> {
  const data = event.parsedJson as Record<string, unknown>;
  if (!data) return;

  const castId     = String(data.cast_id    || '');
  const readCount  = Number(data.read_count ?? 0);
  const txDigest   = event.id?.txDigest as string | undefined;
  const eventSeq   = String(event.id?.eventSeq ?? '');
  const readAt     = parseTimestamp(data.read_at);

  if (!castId || !txDigest) {
    console.warn('[brain][cast-read] missing cast_id or tx_digest, skipping');
    return;
  }

  // Look up cast's fee so we can infer revenue per read
  const { rows: castRows } = await pool.query<{ fee_usdc: string }>(
    'SELECT fee_usdc FROM casts WHERE cast_id = $1',
    [castId]
  );
  const feeUsdc = parseFloat(castRows[0]?.fee_usdc ?? '0');

  // Insert read record (idempotent via tx_digest unique constraint)
  await pool.query(`
    INSERT INTO cast_reads (
      cast_id, read_count_at, revenue_usdc,
      tx_digest, event_seq, read_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tx_digest) DO NOTHING
  `, [castId, readCount, feeUsdc, txDigest, eventSeq, readAt]);

  // Update cast's cumulative read count (use MAX to avoid races from out-of-order events)
  await pool.query(`
    UPDATE casts
    SET reads_all_time = GREATEST(reads_all_time, $1),
        updated_at     = NOW()
    WHERE cast_id = $2
  `, [readCount, castId]);

  console.log(`[brain][cast-read] cast ${castId.slice(0, 14)} read #${readCount} tx=${txDigest.slice(0, 12)}`);

  // Write synapse: reader's last cast → this cast (non-blocking; errors are logged not thrown)
  writeReadSynapse(castId, txDigest).catch(() => {});
}
