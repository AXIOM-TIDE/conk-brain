/**
 * GET /brain.json
 *
 * Machine-readable Cast discovery feed — the primary API for agents querying
 * what intelligence is available on the CONK network.
 *
 * Query params:
 *   sort       — reads_7d | reads_24h | reads_all_time | revenue_usdc_7d | sounded_at | fee_usdc
 *   limit      — max 200, default 50
 *   lighthouse — filter by lighthouse_id
 *   vessel     — filter by vessel_id
 *   mode       — 0=OPEN, 1=SHADOW, 2=GHOST, 3=SEALED, 4=EYES_ONLY
 *   min_fee    — min fee_usdc
 *   max_fee    — max fee_usdc
 *   paid_only  — true/false
 */

import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { CONK_PACKAGE, BRAIN_URL } from '../../config/index.js';

export const brainRouter = Router();

const ALLOWED_SORTS = new Set([
  'reads_7d', 'reads_24h', 'reads_all_time', 'revenue_usdc_7d',
  'sounded_at', 'fee_usdc', 'reads_1h', 'reads_6h',
]);

brainRouter.get('/', async (req, res) => {
  try {
    const sort      = ALLOWED_SORTS.has(req.query.sort as string) ? (req.query.sort as string) : 'reads_7d';
    const limit     = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const lighthouseId = req.query.lighthouse as string | undefined;
    const vesselId     = req.query.vessel     as string | undefined;
    const modeFilter   = req.query.mode !== undefined ? parseInt(req.query.mode as string) : undefined;
    const minFee       = parseFloat(req.query.min_fee as string) || 0;
    const maxFee       = parseFloat(req.query.max_fee as string) || 9999;
    const paidOnly     = req.query.paid_only === 'true';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (lighthouseId)         { conditions.push(`c.lighthouse_id = $${idx++}`); params.push(lighthouseId); }
    if (vesselId)             { conditions.push(`c.vessel_id = $${idx++}`);     params.push(vesselId); }
    if (modeFilter !== undefined && !isNaN(modeFilter)) {
      conditions.push(`c.mode = $${idx++}`); params.push(modeFilter);
    }
    if (minFee > 0)           { conditions.push(`c.fee_usdc >= $${idx++}`);     params.push(minFee); }
    if (maxFee < 9999)        { conditions.push(`c.fee_usdc <= $${idx++}`);     params.push(maxFee); }
    if (paidOnly)             { conditions.push(`c.is_paid = true`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const { rows: casts } = await pool.query(`
      SELECT
        c.cast_id, c.vessel_id, c.hook, c.mode, c.fee_usdc, c.is_paid,
        c.is_lighthouse, c.lighthouse_id, c.sounded_at, c.expires_at,
        c.reads_1h, c.reads_6h, c.reads_24h, c.reads_7d, c.reads_30d, c.reads_all_time,
        c.unique_readers_24h, c.unique_readers_7d,
        c.revenue_usdc_24h, c.revenue_usdc_7d, c.revenue_usdc_all_time,
        c.synapse_count, c.traversal_count,
        v.agent_id, v.agent_name
      FROM casts c
      LEFT JOIN vessels v ON v.vessel_id = c.vessel_id
      ${where}
      ORDER BY c.${sort} DESC NULLS LAST
      LIMIT $${idx}
    `, params);

    const { rows: stats } = await pool.query(`
      SELECT total_casts, paid_casts, total_reads, total_revenue_usdc,
             total_vessels, total_lighthouses, total_synapses, last_updated
      FROM network_stats WHERE id = 1
    `);

    const net = stats[0] || {};

    res.json({
      version:    '1',
      protocol:   'conk',
      network:    'sui:mainnet',
      package:    CONK_PACKAGE,
      brain_url:  BRAIN_URL,
      generated_at: new Date().toISOString(),
      network_stats: {
        total_casts:      Number(net.total_casts      ?? 0),
        paid_casts:       Number(net.paid_casts        ?? 0),
        total_reads:      Number(net.total_reads       ?? 0),
        total_revenue_usdc: Number(net.total_revenue_usdc ?? 0).toFixed(4),
        total_vessels:    Number(net.total_vessels     ?? 0),
        total_lighthouses: Number(net.total_lighthouses ?? 0),
        total_synapses:   Number(net.total_synapses    ?? 0),
        last_updated:     net.last_updated,
      },
      sort_by: sort,
      count:   casts.length,
      casts: casts.map(c => ({
        cast_id:      c.cast_id,
        vessel_id:    c.vessel_id,
        agent_id:     c.agent_id   ?? null,
        agent_name:   c.agent_name ?? null,
        hook:         c.hook,
        mode:         c.mode,
        fee_usdc:     Number(c.fee_usdc),
        is_paid:      c.is_paid,
        is_lighthouse: c.is_lighthouse,
        lighthouse_id: c.lighthouse_id ?? null,
        sounded_at:   c.sounded_at,
        expires_at:   c.expires_at,
        metrics: {
          reads_1h:           c.reads_1h,
          reads_6h:           c.reads_6h,
          reads_24h:          c.reads_24h,
          reads_7d:           c.reads_7d,
          reads_30d:          c.reads_30d,
          reads_all_time:     Number(c.reads_all_time),
          unique_readers_24h: c.unique_readers_24h,
          unique_readers_7d:  c.unique_readers_7d,
          revenue_usdc_24h:   Number(c.revenue_usdc_24h),
          revenue_usdc_7d:    Number(c.revenue_usdc_7d),
          revenue_usdc_all_time: Number(c.revenue_usdc_all_time),
        },
        graph: {
          synapse_count:   c.synapse_count,
          traversal_count: c.traversal_count,
        },
      })),
    });
  } catch (err: any) {
    console.error('[brain][/brain.json]', err.message);
    res.status(500).json({ error: err.message });
  }
});
