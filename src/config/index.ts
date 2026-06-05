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
export const KNOWN_VESSELS: Array<{ vessel_id: string; agent_id: string; agent_name: string; owner_wallet?: string }> = [
  // AgentSpark agents (v13 vessels, bootstrapped 2026-05-22)
  { vessel_id: '0xc06d27426c09668403d8e856ca7a64f808b2c347019f1300f7827dec6a04028b', agent_id: 'neural',   agent_name: 'N.E.U.R.A.L.', owner_wallet: '0x911847f42cc7ff8e1247fb11b4b15177ab1fbe1cd88bf52073f93cf484773517' },
  { vessel_id: '0x58c2f3016abe7017250ad00a108245bd6c4a4b624a295bc6dcf4b653441e8e4e', agent_id: 'aristo',   agent_name: 'A.R.I.S.T.O.', owner_wallet: '0xe82cc80d2aad0821fd8e444971d88d1e556e3ef6a4611e58ca696a3c49f5f8d8' },
  { vessel_id: '0x4ec66bf4862b125030ca25defdda705c391b52741854ec53680ff9a56572a0ac', agent_id: 'crypto',   agent_name: 'C.R.Y.P.T.O.', owner_wallet: '0x5a4057ca8650d9767c9f943197ed534021f03dc3730cc03f9fc1dc59b3ede063' },
  { vessel_id: '0x846b3bdf2115117bff37450f5c70b9ff3bc6c328ea96c6b097f9b6f5a2bbbf0f', agent_id: 'spark',    agent_name: 'S.P.A.R.K.',    owner_wallet: '0x813b4a05c1908c7bca965e04daee7ac319e499342fc8dc9449e3ecaeabcb4d19' },
  // Test / ops vessels
  { vessel_id: '0xe5853e55927364468a622d3483279a7342821620f52c5ac5bf08479a49157107', agent_id: 'franklin', agent_name: 'FRANKLIN' },
  // Buyer daemon vessel (Mac mini intelligence-buyer-daemon, launched 2026-06-04)
  { vessel_id: '0x68377dc84cc5eb073df42d60df4365f7a144426549f3017d5c43221498a24785', agent_id: 'buyer', agent_name: 'BUYER', owner_wallet: '0x9f22950ac273e216cd8cb9d22af34402ae94c7900a7cd0aa9d9fe13dd1ee2087' },
];

// Wallet → vessel mapping. Used by synapse-writer to attribute reads to vessels
// even before VesselLaunched events are indexed with owner_address.
// Also includes the buyer daemon wallet (Mac mini cron, not a Railway agent).
export const KNOWN_WALLETS: Record<string, string> = {
  // AgentSpark agent wallets → their v13 vessel IDs
  '0x911847f42cc7ff8e1247fb11b4b15177ab1fbe1cd88bf52073f93cf484773517': '0xc06d27426c09668403d8e856ca7a64f808b2c347019f1300f7827dec6a04028b', // NEURAL
  '0xe82cc80d2aad0821fd8e444971d88d1e556e3ef6a4611e58ca696a3c49f5f8d8': '0x58c2f3016abe7017250ad00a108245bd6c4a4b624a295bc6dcf4b653441e8e4e', // ARISTO
  '0x5a4057ca8650d9767c9f943197ed534021f03dc3730cc03f9fc1dc59b3ede063': '0x4ec66bf4862b125030ca25defdda705c391b52741854ec53680ff9a56572a0ac', // CRYPTO
  '0x813b4a05c1908c7bca965e04daee7ac319e499342fc8dc9449e3ecaeabcb4d19': '0x846b3bdf2115117bff37450f5c70b9ff3bc6c328ea96c6b097f9b6f5a2bbbf0f', // SPARK
  // Buyer daemon (Mac mini intelligence-buyer-daemon, launched 2026-06-04)
  '0x9f22950ac273e216cd8cb9d22af34402ae94c7900a7cd0aa9d9fe13dd1ee2087': '0x68377dc84cc5eb073df42d60df4365f7a144426549f3017d5c43221498a24785',  // BUYER
};

export const BRAIN_URL = process.env.BRAIN_URL || 'https://brain.agentspark.network';
