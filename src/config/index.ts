// ─── CONK Protocol Constants ────────────────────────────────────────────────
// Package v13 (ACTIVE — two-payment read(), 2026-05-21)
export const CONK_PACKAGE =
  process.env.CONK_PACKAGE ||
  '0x6eca0063f930674f26a4a4593a7ef5ed487e21f31caafe74290ab5df88478cc6';

// CONK_EVENTS_PACKAGE: the package whose event structs are used in emitted events.
// In Sui's upgrade model, events always emit under the package that DEFINED the struct.
// All CONK event structs were defined in v11 (0x734b...) and stay anchored there
// even when v13 is the active call-dispatch package.
export const CONK_EVENTS_PACKAGE =
  process.env.CONK_EVENTS_PACKAGE ||
  '0x734b19fa1696dec30f8cae38f1cdbf0ab5a12720735f7c7b0d4935cab31732cc'; // v11 — event definition anchor

export const ABYSS_ID         = '0x075c8667d1780bdde01a8175cd458aa345b3f6e2a84c45b91f82b344a4325bd0';
export const DRIFT_ID         = '0x9312b6837bb12381849b413636064cd8d56b6ef84bf891b3f756b3cbb6157fad';
export const LIGHTHOUSE_REGISTRY = '0x5ee0f0a6ad1b89412a2e05def4f1e0ad6e606df3751c030e9601fd155b444e94';
export const PROTOCOL_CONFIG  = '0xdc8e5131d6e3bec492a2e12b1d7beddbfec709ae5def8e775dab59c7a45421ea';

export const SUI_RPC = process.env.SUI_RPC || 'https://fullnode.mainnet.sui.io:443';
export const PORT    = parseInt(process.env.PORT || '3100');

// Polling
export const POLL_INTERVAL_MS   = parseInt(process.env.POLL_INTERVAL_MS   || '30000');  // 30s
export const ROLLUP_INTERVAL_MS = parseInt(process.env.ROLLUP_INTERVAL_MS || '300000'); // 5min
export const BATCH_SIZE         = 50;

// USDC constants (on-chain amounts are in micro-USDC, 6 decimals)
export const USDC_DECIMALS     = 6;
export const PROTOCOL_READ_FEE = 0.001; // $0.001 USDC flat fee per read

// ─── Verified event type strings (from protocol/sources/*.move) ─────────────
// Format: PACKAGE::MODULE::STRUCT
// NOTE: Uses CONK_EVENTS_PACKAGE (v11), not CONK_PACKAGE (v13).
// Sui anchors event struct type IDs to the package that first defined them.
export const EVENT_TYPES = {
  // cast.move → CastSounded { cast_id, vessel_id, hook(bytes), mode, duration, created_at, expires_at }
  CAST_SOUNDED:       `${CONK_EVENTS_PACKAGE}::cast::CastSounded`,
  // cast.move → CastRead { cast_id, read_count, read_at }  (no reader/fee in event)
  CAST_READ:          `${CONK_EVENTS_PACKAGE}::cast::CastRead`,
  // drift.move → CastIndexed { cast_id, hook, vessel_tier, created_at, expires_at, mode }
  CAST_INDEXED:       `${CONK_EVENTS_PACKAGE}::drift::CastIndexed`,
  // drift.move → LighthouseIndexed { cast_id, lighthouse_id, birth_path, born_at }
  LIGHTHOUSE_INDEXED: `${CONK_EVENTS_PACKAGE}::drift::LighthouseIndexed`,
  // cast.move → LighthouseBorn { cast_id, birth_path, read_count, born_at }
  LIGHTHOUSE_BORN:    `${CONK_EVENTS_PACKAGE}::cast::LighthouseBorn`,
  // vessel.move → VesselLaunched { vessel_id, harbor_id, tier, launched_at, burn_after_cast }
  VESSEL_LAUNCHED:    `${CONK_EVENTS_PACKAGE}::vessel::VesselLaunched`,
} as const;

// Cast mode constants (from cast.move)
export const CAST_MODE = {
  OPEN:       0,  // free, public
  SHADOW:     1,  // paid
  GHOST:      2,  // paid + burn after first read
  SEALED:     3,  // paid + only specific recipient
  EYES_ONLY:  4,  // paid + limited claims (Dock)
} as const;

// Vessel tier constants (from vessel.move)
export const VESSEL_TIER = {
  GHOST:  0,
  SHADOW: 1,
  OPEN:   2,
} as const;

// Known AgentSpark vessels — pre-seed on startup
// v13 vessel IDs (active as of 2026-05-21)
export const KNOWN_VESSELS = [
  // AgentSpark agents (v13 vessels, bootstrapped 2026-05-22)
  { vessel_id: '0xc06d27426c09668403d8e856ca7a64f808b2c347019f1300f7827dec6a04028b', agent_id: 'neural',   agent_name: 'N.E.U.R.A.L.' },
  { vessel_id: '0x58c2f3016abe7017250ad00a108245bd6c4a4b624a295bc6dcf4b653441e8e4e', agent_id: 'aristo',   agent_name: 'A.R.I.S.T.O.' },
  { vessel_id: '0x4ec66bf4862b125030ca25defdda705c391b52741854ec53680ff9a56572a0ac', agent_id: 'crypto',   agent_name: 'C.R.Y.P.T.O.' },
  { vessel_id: '0x846b3bdf2115117bff37450f5c70b9ff3bc6c328ea96c6b097f9b6f5a2bbbf0f', agent_id: 'spark',    agent_name: 'S.P.A.R.K.' },
  // Test / ops vessels
  { vessel_id: '0xe5853e55927364468a622d3483279a7342821620f52c5ac5bf08479a49157107', agent_id: 'franklin', agent_name: 'FRANKLIN' },
] as const;

export const BRAIN_URL = process.env.BRAIN_URL || 'https://brain.agentspark.network';
