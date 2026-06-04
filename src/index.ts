/**
 * CONK Brain Indexer — Entry Point
 *
 * Startup sequence:
 *   1. Migrate DB (idempotent schema application)
 *   2. Pre-seed known vessels
 *   3. Start Express API
 *   4. Start Sui event pollers (watermark-based, one per event type)
 *   5. Start analytics rollup scheduler
 */

import 'dotenv/config';
import { migrate }              from './db/migrate.js';
import { pool }                 from './db/pool.js';
import { createServer }         from './api/server.js';
import { startPollers }         from './indexer/poller.js';
import { startRollupScheduler } from './analytics/rollups.js';
import { runSynapseBackfill }   from './indexer/synapse-backfill.js';
import { KNOWN_VESSELS }        from './config/index.js';

async function main() {
  console.log('[brain] ═══════════════════════════════════════');
  console.log('[brain]  CONK Brain Indexer v0.1.0');
  console.log('[brain]  Knowledge graph for the CONK network');
  console.log('[brain] ═══════════════════════════════════════');

  // 1. Apply schema (idempotent — safe to run on every startup)
  await migrate();

  // 2. Pre-seed known AgentSpark vessels
  for (const v of KNOWN_VESSELS) {
    await pool.query(`
      INSERT INTO vessels (vessel_id, owner_address, agent_id, agent_name)
      VALUES ($1, 'unknown', $2, $3)
      ON CONFLICT (vessel_id) DO UPDATE
      SET agent_id   = COALESCE(EXCLUDED.agent_id,   vessels.agent_id),
          agent_name = COALESCE(EXCLUDED.agent_name, vessels.agent_name)
    `, [v.vessel_id, v.agent_id, v.agent_name]);
  }
  console.log(`[brain] Pre-seeded ${KNOWN_VESSELS.length} known vessels ✓`);

  // 3. Start REST API
  createServer();

  // 4. Start event pollers (catch-up from last watermark, then poll every 30s)
  startPollers();

  // 5. Start analytics rollups (every 5min)
  startRollupScheduler();

  // 6. Backfill synapses for existing casts/reads (async, non-blocking)
  runSynapseBackfill().catch(err => {
    console.warn('[brain][backfill] Backfill error (non-fatal):', err.message);
  });

  console.log('[brain] All systems go ✓');
}

main().catch(err => {
  console.error('[brain] Fatal startup error:', err);
  process.exit(1);
});
