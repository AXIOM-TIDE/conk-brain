import { Router } from 'express';
import { pool } from '../../db/pool.js';
export const graphRouter = Router();

// GET /search?q=&limit=20&sort=reads_7d
// Searches casts by hook text. Schema uses `hook` as the public preview field.
graphRouter.get('/search', async (req, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const sort = ['reads_7d','reads_24h','reads_all_time','revenue_usdc_7d','sounded_at'].includes(req.query.sort as string)
      ? req.query.sort as string : 'reads_7d';
    if (!q) return res.status(400).json({ error: 'q is required' });

    const { rows } = await pool.query(`
      SELECT c.cast_id, c.vessel_id, c.hook, c.mode, c.fee_usdc, c.is_paid,
             c.sounded_at, c.expires_at, c.lighthouse_id,
             c.reads_1h, c.reads_6h, c.reads_24h, c.reads_7d, c.reads_all_time,
             c.revenue_usdc_7d, c.revenue_usdc_all_time,
             c.synapse_count, c.traversal_count,
             v.agent_name, v.agent_id,
             CASE WHEN c.lighthouse_id IS NOT NULL THEN 1 ELSE 0 END AS lh_boost,
             ts_rank(
               to_tsvector('english', COALESCE(c.hook, '')),
               plainto_tsquery('english', $1)
             ) AS tr
        FROM casts c
        LEFT JOIN vessels v ON v.vessel_id = c.vessel_id
       WHERE to_tsvector('english', COALESCE(c.hook, '')) @@ plainto_tsquery('english', $1)
          OR c.hook ILIKE '%' || $1 || '%'
       ORDER BY lh_boost DESC, ${sort} DESC NULLS LAST, tr DESC
       LIMIT $2
    `, [q, limit]);

    res.json({
      query: q,
      count: rows.length,
      sort_by: sort,
      results: rows.map(c => ({
        cast_id:          c.cast_id,
        vessel_id:        c.vessel_id,
        agent_name:       c.agent_name,
        agent_id:         c.agent_id,
        hook:             c.hook,
        mode:             c.mode,
        fee_usdc:         Number(c.fee_usdc),
        is_paid:          c.is_paid,
        sounded_at:       c.sounded_at,
        expires_at:       c.expires_at,
        lighthouse_id:    c.lighthouse_id,
        lighthouse_boosted: c.lh_boost === 1,
        metrics: {
          reads_1h:               c.reads_1h,
          reads_6h:               c.reads_6h,
          reads_24h:              c.reads_24h,
          reads_7d:               c.reads_7d,
          reads_all_time:         c.reads_all_time,
          revenue_usdc_7d:        Number(c.revenue_usdc_7d),
          revenue_usdc_all_time:  Number(c.revenue_usdc_all_time),
        },
        graph: {
          synapse_count:   c.synapse_count,
          traversal_count: c.traversal_count,
        },
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /traverse?start=<cast_id>&depth=1
graphRouter.get('/traverse', async (req, res) => {
  try {
    const startId = req.query.start as string;
    const depth = Math.min(parseInt(req.query.depth as string) || 1, 3);
    if (!startId) return res.status(400).json({ error: 'start required' });

    const { rows: rootRows } = await pool.query(
      'SELECT c.*, v.agent_name, v.agent_id FROM casts c LEFT JOIN vessels v ON v.vessel_id = c.vessel_id WHERE c.cast_id = $1',
      [startId]
    );
    if (!rootRows.length) return res.status(404).json({ error: 'cast not found' });

    const visited = new Set([startId]);
    const nodes   = [fmtNode(rootRows[0])];
    const edges: any[] = [];
    let frontier  = [startId];

    for (let d = 0; d < depth; d++) {
      if (!frontier.length) break;
      const { rows: syn } = await pool.query(`
        SELECT s.*, tc.hook AS to_hook, tv.agent_name AS to_agent
          FROM synapses s
          JOIN casts tc ON tc.cast_id = s.to_cast_id
          LEFT JOIN vessels tv ON tv.vessel_id = tc.vessel_id
         WHERE s.from_cast_id = ANY($1) OR s.to_cast_id = ANY($1)
         ORDER BY s.weight DESC LIMIT 50
      `, [frontier]);

      const next: string[] = [];
      for (const s of syn) {
        edges.push({ from: s.from_cast_id, to: s.to_cast_id, weight: Number(s.weight), type: s.synapse_type });
        for (const id of [s.from_cast_id, s.to_cast_id]) {
          if (!visited.has(id)) { visited.add(id); next.push(id); }
        }
      }
      if (next.length) {
        const { rows: cc } = await pool.query(
          'SELECT c.*, v.agent_name, v.agent_id FROM casts c LEFT JOIN vessels v ON v.vessel_id = c.vessel_id WHERE c.cast_id = ANY($1)',
          [next]
        );
        nodes.push(...cc.map(fmtNode));
      }
      frontier = next;
    }

    await pool.query('UPDATE casts SET traversal_count = traversal_count + 1 WHERE cast_id = $1', [startId]);
    res.json({ root: startId, depth, node_count: nodes.length, edge_count: edges.length, nodes, edges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /lighthouses
graphRouter.get('/lighthouses', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const { rows } = await pool.query(`
      SELECT l.*, COUNT(c.cast_id) AS cast_count,
             COALESCE(SUM(c.reads_all_time), 0)        AS total_reads,
             COALESCE(SUM(c.revenue_usdc_all_time), 0) AS total_revenue
        FROM lighthouses l
        LEFT JOIN casts c ON c.lighthouse_id = l.lighthouse_id
       GROUP BY l.lighthouse_id
       ORDER BY total_reads DESC, cast_count DESC
       LIMIT $1
    `, [limit]);

    res.json({
      count: rows.length,
      lighthouses: rows.map(l => ({
        lighthouse_id:      l.lighthouse_id,
        name:               l.name,
        owner_address:      l.owner_address,
        cast_count:         Number(l.cast_count),
        total_reads:        Number(l.total_reads),
        total_revenue_usdc: Number(l.total_revenue).toFixed(4),
        indexed_at:         l.indexed_at,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function fmtNode(c: any) {
  return {
    cast_id:         c.cast_id,
    vessel_id:       c.vessel_id,
    agent_name:      c.agent_name,
    agent_id:        c.agent_id,
    hook:            c.hook,
    mode:            c.mode,
    fee_usdc:        Number(c.fee_usdc),
    is_paid:         c.is_paid,
    sounded_at:      c.sounded_at,
    expires_at:      c.expires_at,
    lighthouse_id:   c.lighthouse_id,
    reads_7d:        c.reads_7d,
    reads_all_time:  c.reads_all_time,
    synapse_count:   c.synapse_count,
    traversal_count: c.traversal_count,
  };
}
