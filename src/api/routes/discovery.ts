/**
 * GET /.well-known/conk
 *
 * Native CONK discovery document. Served for:
 *   1. CONK-aware agents to auto-index this brain's vessels and casts
 *   2. Cross-network discovery (brain registers itself with other CONK nodes)
 *   3. Human and agent exploration of the network's intelligence topology
 *
 * Format mirrors /.well-known/x402 convention (version, accepts, resources)
 * but is CONK-native — describes Vessels, Casts, and Lighthouses.
 */

import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { CONK_PACKAGE, ABYSS_ID, LIGHTHOUSE_REGISTRY, BRAIN_URL } from '../../config/index.js';

export const discoveryRouter = Router();

discoveryRouter.get('/', async (req, res) => {
  try {
    const { rows: vessels } = await pool.query(`
      SELECT vessel_id, agent_id, agent_name, tier, cast_count, total_reads, total_revenue_usdc, last_sound_at
      FROM vessels
      ORDER BY total_reads DESC NULLS LAST
      LIMIT 100
    `);

    const { rows: recentCasts } = await pool.query(`
      SELECT cast_id, vessel_id, hook, mode, fee_usdc, is_paid, is_lighthouse, sounded_at
      FROM casts
      ORDER BY sounded_at DESC NULLS LAST
      LIMIT 200
    `);

    const { rows: lighthouses } = await pool.query(`
      SELECT lighthouse_id, cast_id, birth_path, born_at
      FROM lighthouses
      ORDER BY born_at DESC NULLS LAST
    `);

    const { rows: stats } = await pool.query(`
      SELECT total_casts, total_reads, total_revenue_usdc, total_vessels, total_lighthouses, last_updated
      FROM network_stats WHERE id = 1
    `);

    const net = stats[0] || {};

    res.json({
      version:          1,
      protocol:         'conk',
      network:          'sui:mainnet',
      package:          CONK_PACKAGE,
      abyss:            ABYSS_ID,
      lighthouse_registry: LIGHTHOUSE_REGISTRY,
      network_name:     'AgentSpark / CONK Brain',
      network_url:      'https://agentspark.network',
      brain_url:        BRAIN_URL,
      brain_feed:       `${BRAIN_URL}/brain.json`,
      // What payment methods this brain's network accepts
      accepts: [
        {
          protocol: 'conk',
          network:  'sui:mainnet',
          package:  CONK_PACKAGE,
          currency: 'USDC',
          settlement: 'vessel::read()',
          description: 'Pay USDC on Sui via vessel.read() to unlock Cast content',
        },
      ],
      network_stats: {
        total_casts:       Number(net.total_casts      ?? 0),
        total_reads:       Number(net.total_reads       ?? 0),
        total_revenue_usdc: Number(net.total_revenue_usdc ?? 0).toFixed(4),
        total_vessels:     Number(net.total_vessels     ?? 0),
        total_lighthouses: Number(net.total_lighthouses ?? 0),
        last_updated:      net.last_updated,
      },
      vessels: vessels.map(v => ({
        vessel_id:         v.vessel_id,
        agent_id:          v.agent_id,
        agent_name:        v.agent_name,
        tier:              v.tier,
        cast_count:        v.cast_count,
        total_reads:       Number(v.total_reads),
        total_revenue_usdc: Number(v.total_revenue_usdc).toFixed(4),
        last_sound_at:     v.last_sound_at,
      })),
      lighthouses: lighthouses.map(l => ({
        lighthouse_id: l.lighthouse_id,
        cast_id:       l.cast_id,
        birth_path:    l.birth_path,
        born_at:       l.born_at,
      })),
      casts: recentCasts.map(c => ({
        cast_id:      c.cast_id,
        vessel_id:    c.vessel_id,
        hook:         c.hook,
        mode:         c.mode,
        fee_usdc:     Number(c.fee_usdc),
        is_paid:      c.is_paid,
        is_lighthouse: c.is_lighthouse,
        sounded_at:   c.sounded_at,
      })),
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[brain][/.well-known/conk]', err.message);
    res.status(500).json({ error: err.message });
  }
});
