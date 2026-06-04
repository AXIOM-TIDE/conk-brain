/**
 * Graph Query API
 *
 * GET /query/casts         — cast list with filters
 * GET /query/vessels       — vessel leaderboard
 * GET /query/lighthouses   — all lighthouses
 * GET /query/similar       — semantic neighbors via pgvector
 * GET /query/synapses      — graph edges from/to a cast
 * GET /query/stats         — protocol-wide stats + sync cursor status
 * GET /query/vessel/:id    — single vessel profile with cast list
 */

import { Router } from 'express';
import { pool } from '../../db/pool.js';

export const queryRouter = Router();

// ── GET /query/casts ─────────────────────────────────────────────────────────
queryRouter.get('/casts', async (req, res) => {
  try {
    const vessel  = req.query.vessel as string | undefined;
    const mode    = req.query.mode !== undefined ? parseInt(req.query.mode as string) : undefined;
    const sort    = ['reads_7d','reads_all_time','sounded_at','fee_usdc'].includes(req.query.sort as string)
      ? (req.query.sort as string) : 'sounded_at';
    const limit  = Math.min(parseInt(req.query.limit  as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const conds: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (vessel) { conds.push(`vessel_id = $${idx++}`); params.push(vessel); }
    if (mode !== undefined && !isNaN(mode)) { conds.push(`mode = $${idx++}`); params.push(mode); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await pool.query(`
      SELECT cast_id, vessel_id, hook, mode, fee_usdc, is_paid, is_lighthouse,
             reads_7d, reads_all_time, revenue_usdc_all_time, sounded_at, expires_at
      FROM casts ${where}
      ORDER BY ${sort} DESC NULLS LAST
      LIMIT $${idx++} OFFSET $${idx}
    `, params);
    res.json({ casts: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /query/vessels ───────────────────────────────────────────────────────
queryRouter.get('/vessels', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT vessel_id, agent_id, agent_name, tier, cast_count,
             total_reads, total_revenue_usdc, first_sound_at, last_sound_at, launched_at
      FROM vessels
      ORDER BY total_reads DESC NULLS LAST
      LIMIT 100
    `);
    res.json({ vessels: rows });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /query/vessel/:id ────────────────────────────────────────────────────
queryRouter.get('/vessel/:id', async (req, res) => {
  try {
    const { rows: v } = await pool.query(
      'SELECT * FROM vessels WHERE vessel_id = $1', [req.params.id]
    );
    if (!v.length) return res.status(404).json({ error: 'vessel not found' });

    const { rows: casts } = await pool.query(`
      SELECT cast_id, hook, mode, fee_usdc, is_paid, is_lighthouse,
             reads_7d, reads_all_time, revenue_usdc_all_time, sounded_at
      FROM casts WHERE vessel_id = $1
      ORDER BY sounded_at DESC NULLS LAST
      LIMIT 50
    `, [req.params.id]);

    res.json({ vessel: v[0], casts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /query/lighthouses ───────────────────────────────────────────────────
queryRouter.get('/lighthouses', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.lighthouse_id, l.cast_id, l.birth_path, l.read_count_at_birth,
             l.total_reads, l.born_at,
             c.hook, c.vessel_id, c.fee_usdc, c.reads_all_time
      FROM lighthouses l
      LEFT JOIN casts c ON c.cast_id = l.cast_id
      ORDER BY l.born_at DESC NULLS LAST
    `);
    res.json({ lighthouses: rows });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /query/similar?cast_id= ─────────────────────────────────────────────
// Semantic similarity search via pgvector cosine distance
queryRouter.get('/similar', async (req, res) => {
  try {
    const castId = req.query.cast_id as string;
    if (!castId) return res.status(400).json({ error: 'cast_id required' });

    const { rows: source } = await pool.query(
      'SELECT embedding FROM casts WHERE cast_id = $1 AND embedding IS NOT NULL', [castId]
    );
    if (!source[0]?.embedding) {
      return res.json({ similar: [], note: 'no embedding yet — run embedding generation job' });
    }

    const { rows } = await pool.query(`
      SELECT cast_id, hook, fee_usdc, reads_7d, is_lighthouse,
             1 - (embedding <=> $1::vector) AS similarity
      FROM casts
      WHERE cast_id != $2 AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT 10
    `, [source[0].embedding, castId]);

    res.json({ similar: rows });
  } catch (err: any) {
    if (err.message?.includes('operator does not exist') || err.message?.includes('vector')) {
      return res.json({ similar: [], note: 'pgvector not available on this deployment' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── GET /query/synapses?cast_id= ─────────────────────────────────────────────
queryRouter.get('/synapses', async (req, res) => {
  try {
    const castId    = req.query.cast_id as string;
    const direction = req.query.direction === 'to' ? 'to' : 'from';
    if (!castId) return res.status(400).json({ error: 'cast_id required' });

    const col = direction === 'from' ? 'from_cast_id' : 'to_cast_id';
    const { rows } = await pool.query(`
      SELECT s.id, s.from_cast_id, s.to_cast_id, s.weight, s.synapse_type,
             s.traversal_count, s.created_at,
             c.hook AS target_hook, c.fee_usdc AS target_fee, c.reads_7d AS target_reads_7d
      FROM synapses s
      LEFT JOIN casts c ON c.cast_id = (CASE WHEN $1 = 'from' THEN s.to_cast_id ELSE s.from_cast_id END)
      WHERE s.${col} = $2
      ORDER BY s.weight DESC, s.traversal_count DESC
      LIMIT 50
    `, [direction, castId]);

    res.json({ synapses: rows, direction });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /query/stats ─────────────────────────────────────────────────────────
queryRouter.get('/stats', async (req, res) => {
  try {
    const { rows: net } = await pool.query('SELECT * FROM network_stats WHERE id = 1');
    const { rows: cursors } = await pool.query(
      'SELECT event_type, last_synced, total_events FROM sync_cursors ORDER BY last_synced DESC NULLS LAST'
    );
    res.json({ network: net[0] || {}, sync_cursors: cursors });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
