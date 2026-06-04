import { pool } from '../../db/pool.js';
import type { SourceEvent } from '../source-provider.js';

export async function processReadEvent(event: SourceEvent): Promise<void> {
  const { payload, timestamp } = event;
  const castId = payload.cast_id as string;
  const txDigest = payload._txDigest as string;
  if (!castId || !txDigest) return;
  await pool.query(`
    INSERT INTO cast_reads (cast_id, reader_address, tx_digest, event_seq, read_at)
    VALUES ($1,'unknown',$2,$3,$4) ON CONFLICT (tx_digest) DO NOTHING
  `, [castId, txDigest, payload._eventSeq as string, timestamp]);
  console.log(`[brain][read] ${castId.slice(0,12)} | tx ${txDigest.slice(0,12)}`);
}
