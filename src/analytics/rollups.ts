/**
 * CONK Brain — Rolling Metrics Rollup
 *
 * Runs on a schedule (default 5min) to compute rolling window aggregations
 * from raw cast_reads into the casts table's denormalized metric columns.
 *
 * Pattern adapted from x402scan's analytics sync pattern:
 * raw events → rolling window aggregations per entity.
 *
 * For MVP we use Postgres instead of ClickHouse. These queries are fine
 * for the data volumes we'll see in the near term. Add ClickHouse when
 * daily read volume exceeds ~1M rows/day.
 */

import { pool } from '../db/pool.js';
import { ROLLUP_INTERVAL_MS } from '../config/index.js';

export async function refreshCastMetrics(): Promise<void> {
  const start = Date.now();
  console.log('[brain][rollups] refreshing cast metrics...');

  const client = await pool.connect();
  try {
    // Rolling read counts per cast
    await client.query(`
      UPDATE casts c
      SET
        reads_1h  = (
          SELECT COUNT(*) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '1 hour'
        ),
        reads_6h  = (
          SELECT COUNT(*) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '6 hours'
        ),
        reads_24h = (
          SELECT COUNT(*) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '24 hours'
        ),
        reads_7d  = (
          SELECT COUNT(*) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '7 days'
        ),
        reads_30d = (
          SELECT COUNT(*) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '30 days'
        ),
        reads_all_time = GREATEST(c.reads_all_time, (
          SELECT COUNT(*) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
        )),
        unique_readers_24h = (
          SELECT COUNT(DISTINCT reader_address) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '24 hours'
            AND r.reader_address != 'unknown'
        ),
        unique_readers_7d = (
          SELECT COUNT(DISTINCT reader_address) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '7 days'
            AND r.reader_address != 'unknown'
        ),
        revenue_usdc_24h = (
          SELECT COALESCE(SUM(revenue_usdc), 0) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '24 hours'
        ),
        revenue_usdc_7d = (
          SELECT COALESCE(SUM(revenue_usdc), 0) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
            AND r.read_at >= NOW() - INTERVAL '7 days'
        ),
        revenue_usdc_all_time = (
          SELECT COALESCE(SUM(revenue_usdc), 0) FROM cast_reads r
          WHERE r.cast_id = c.cast_id
        ),
        updated_at = NOW()
    `);

    // Rolling vessel aggregates
    await client.query(`
      UPDATE vessels v
      SET
        cast_count    = (SELECT COUNT(*) FROM casts c WHERE c.vessel_id = v.vessel_id),
        total_reads   = (SELECT COALESCE(SUM(reads_all_time), 0) FROM casts c WHERE c.vessel_id = v.vessel_id),
        total_revenue_usdc = (SELECT COALESCE(SUM(revenue_usdc_all_time), 0) FROM casts c WHERE c.vessel_id = v.vessel_id),
        last_sound_at = (SELECT MAX(sounded_at) FROM casts c WHERE c.vessel_id = v.vessel_id),
        updated_at    = NOW()
    `);

    // Network stats singleton
    await client.query(`
      UPDATE network_stats
      SET
        total_casts     = (SELECT COUNT(*) FROM casts),
        paid_casts      = (SELECT COUNT(*) FROM casts WHERE is_paid = true),
        total_reads     = (SELECT COALESCE(SUM(reads_all_time), 0) FROM casts),
        total_revenue_usdc = (SELECT COALESCE(SUM(revenue_usdc_all_time), 0) FROM casts),
        total_vessels   = (SELECT COUNT(*) FROM vessels),
        total_lighthouses = (SELECT COUNT(*) FROM lighthouses),
        total_synapses  = (SELECT COUNT(*) FROM synapses),
        last_updated    = NOW()
      WHERE id = 1
    `);

    const elapsed = Date.now() - start;
    console.log(`[brain][rollups] done in ${elapsed}ms`);
  } finally {
    client.release();
  }
}

export function startRollupScheduler(): void {
  console.log(`[brain][rollups] scheduler starting (interval: ${ROLLUP_INTERVAL_MS}ms)`);

  // Run immediately
  refreshCastMetrics().catch(err =>
    console.error('[brain][rollups] Initial run error:', err.message)
  );

  setInterval(() => {
    refreshCastMetrics().catch(err =>
      console.error('[brain][rollups] Rollup error:', err.message)
    );
  }, ROLLUP_INTERVAL_MS);
}
