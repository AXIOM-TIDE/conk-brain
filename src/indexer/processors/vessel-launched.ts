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
import { parseTimestamp, suiClient } from '../sui-rpc.js';
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

  // Enrich owner_address from tx sender (not in the event itself)
  let ownerAddress = known?.owner_wallet ?? 'unknown';
  const txDigest = event.id?.txDigest as string | undefined;
  if (txDigest && ownerAddress === 'unknown') {
    try {
      const tx = await suiClient.getTransactionBlock({
        digest: txDigest,
        options: { showInput: true },
      });
      const sender = (tx?.transaction?.data as any)?.sender;
      if (sender) ownerAddress = sender;
    } catch {
      // non-fatal — proceed with 'unknown'
    }
  }

  await pool.query(`
    INSERT INTO vessels (
      vessel_id, harbor_id, owner_address, agent_id, agent_name,
      tier, burn_after_cast, launched_at, indexed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (vessel_id) DO UPDATE
    SET harbor_id       = COALESCE(EXCLUDED.harbor_id, vessels.harbor_id),
        owner_address   = CASE WHEN vessels.owner_address = 'unknown' THEN EXCLUDED.owner_address ELSE vessels.owner_address END,
        tier            = EXCLUDED.tier,
        burn_after_cast = EXCLUDED.burn_after_cast,
        launched_at     = COALESCE(vessels.launched_at, EXCLUDED.launched_at),
        agent_id        = COALESCE(EXCLUDED.agent_id, vessels.agent_id),
        agent_name      = COALESCE(EXCLUDED.agent_name, vessels.agent_name),
        updated_at      = NOW()
  `, [
    vesselId, harborId, ownerAddress,
    known?.agent_id ?? null, known?.agent_name ?? null,
    tier, burnAfterCast, launchedAt,
  ]);

  const label = known?.agent_name ?? vesselId.slice(0, 14);
  console.log(`[brain][vessel-launched] ${label} owner=${ownerAddress.slice(0, 14)} tier=${tier} burn=${burnAfterCast}`);
}
