/**
 * Processor: vessel::VesselLaunched
 *
 * Emitted by vessel.launch() when a new Vessel is created.
 *
 * On-chain event fields:
 *   vessel_id:       address — the Vessel object ID
 *   harbor_id:       address — the Harbor it belongs to
 *   tier:            u8     — 0=GHOST, 1=SHADOW, 2=OPEN
 *   launched_at:     u64    — ms timestamp
 *   burn_after_cast: bool   — if true, Vessel burns after first Cast
 */

import { pool } from '../../db/pool.js';
import { parseTimestamp } from '../sui-rpc.js';
import { KNOWN_VESSELS } from '../../config/index.js';

export async function processVesselLaunched(event: any): Promise<void> {
  const data = event.parsedJson as Record<string, unknown>;
  if (!data) return;

  const vesselId      = String(data.vessel_id       || '');
  const harborId      = String(data.harbor_id       || '');
  const tier          = Number(data.tier            ?? 1);
  const burnAfterCast = Boolean(data.burn_after_cast);
  const launchedAt    = parseTimestamp(data.launched_at);

  if (!vesselId) return;

  const known = KNOWN_VESSELS.find(v => v.vessel_id === vesselId);

  await pool.query(`
    INSERT INTO vessels (
      vessel_id, harbor_id, owner_address, agent_id, agent_name,
      tier, burn_after_cast, launched_at, indexed_at
    ) VALUES ($1, $2, 'unknown', $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (vessel_id) DO UPDATE
    SET harbor_id      = COALESCE(EXCLUDED.harbor_id, vessels.harbor_id),
        tier           = EXCLUDED.tier,
        burn_after_cast = EXCLUDED.burn_after_cast,
        launched_at    = COALESCE(vessels.launched_at, EXCLUDED.launched_at),
        agent_id       = COALESCE(EXCLUDED.agent_id, vessels.agent_id),
        agent_name     = COALESCE(EXCLUDED.agent_name, vessels.agent_name),
        updated_at     = NOW()
  `, [
    vesselId, harborId,
    known?.agent_id ?? null, known?.agent_name ?? null,
    tier, burnAfterCast, launchedAt,
  ]);

  const label = known?.agent_name ?? vesselId.slice(0, 14);
  console.log(`[brain][vessel-launched] ${label} tier=${tier} harbor=${harborId.slice(0, 10)} burn=${burnAfterCast}`);
}
