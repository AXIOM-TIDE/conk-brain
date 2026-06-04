import express from 'express';
import cors from 'cors';
import { brainRouter }     from './routes/brain.js';
import { discoveryRouter } from './routes/discovery.js';
import { queryRouter }     from './routes/query.js';
import { getAllWatermarks } from '../indexer/watermark.js';
import { PORT }            from '../config/index.js';

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', async (_, res) => {
    try {
      const cursors = await getAllWatermarks();
      res.json({
        ok:      true,
        service: 'conk-brain',
        version: '0.1.0',
        ts:      new Date().toISOString(),
        sync:    cursors,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── CONK native discovery doc ──────────────────────────────────────────────
  app.use('/.well-known/conk', discoveryRouter);

  // ── Machine-readable Cast intelligence feed ────────────────────────────────
  app.use('/brain.json', brainRouter);

  // ── Graph query API ────────────────────────────────────────────────────────
  app.use('/query', queryRouter);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((_, res) => {
    res.status(404).json({
      error:    'not_found',
      service:  'conk-brain',
      endpoints: ['/health', '/brain.json', '/.well-known/conk', '/query/casts',
                  '/query/vessels', '/query/lighthouses', '/query/similar',
                  '/query/synapses', '/query/stats'],
    });
  });

  app.listen(PORT, () => {
    console.log(`[brain] API listening on :${PORT}`);
  });

  return app;
}
