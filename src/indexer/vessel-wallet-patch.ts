/**
 * Vessel Wallet Patch
 *
 * Runs once on startup to backfill owner_address on vessels that were
 * indexed before the VesselLaunched processor captured tx sender.
 *
 * Uses KNOWN_VESSELS[].owner_wallet + KNOWN_WALLETS as the source of truth.
 * Idempotent — only updates rows where owner_address = 'unknown'.
 */

import { pool } from '../db/pool.js';
import { KNOWN_VESSELS, KNOWN_WALLETS } from '../config/index.js';

export async function runVesselWalletPatch(): Promise<void> {
  let patched = 0;

  // Patch from KNOWN_VESSELS (vessel_id → owner_wallet)
  for (const v of KNOWN_VESSELS) {
    if (!v.owner_wallet) continue;
    const { rowCount } = await pool.query(`
      UPDATE vessels
         SET owner_address = $1, updated_at = NOW()
       WHERE vessel_id = $2
         AND (owner_address = 'unknown' OR owner_address IS NULL)
    `, [v.owner_wallet, v.vessel_id]);
    if (rowCount && rowCount > 0) patched++;
  }

  // Patch from KNOWN_WALLETS (wallet → vessel_id, reverse lookup)
  for (const [wallet, vesselId] of Object.entries(KNOWN_WALLETS)) {
    const { rowCount } = await pool.query(`
      UPDATE vessels
         SET owner_address = $1, updated_at = NOW()
       WHERE vessel_id = $2
         AND (owner_address = 'unknown' OR owner_address IS NULL)
    `, [wallet, vesselId]);
    if (rowCount && rowCount > 0) patched++;
  }

  if (patched > 0) {
    console.log(`[brain][vessel-patch] Patched owner_address on ${patched} vessels`);
  } else {
    console.log('[brain][vessel-patch] All vessels already have owner_address set');
  }
}
