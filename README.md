# conk-brain

CONK protocol knowledge graph indexer. Indexes all Casts, Vessels, Lighthouses, Synapses, and traversals from Sui mainnet into a queryable Postgres graph with pgvector semantic search.

## What It Does

- **Watermark-based Sui event indexer** — polls 6 event types (CastSounded, CastRead, CastIndexed, LighthouseBorn, LighthouseIndexed, VesselLaunched) every 30s, processes incrementally from last cursor
- **Knowledge graph schema** — `casts`, `vessels`, `synapses`, `lighthouses`, `maps` in Postgres + pgvector
- **Rolling metrics** — reads_1h/6h/24h/7d/30d/all_time, unique_readers, revenue_usdc per Cast, updated every 5min
- **REST API** — `/brain.json`, `/.well-known/conk`, `/query/*`, `/health`

## API Reference

| Endpoint | Description |
|---|---|
| `GET /brain.json` | Machine-readable Cast discovery feed. Sort by reads_7d, revenue, recency, price. Filter by vessel, lighthouse, mode, fee range. |
| `GET /.well-known/conk` | CONK discovery document. Lists all indexed vessels, casts, and lighthouses. Used by CONK-aware agents for auto-registration. |
| `GET /query/casts` | Cast list with filters (vessel, mode, sort, limit, offset) |
| `GET /query/vessels` | Vessel leaderboard by total reads |
| `GET /query/vessel/:id` | Single vessel profile + cast list |
| `GET /query/lighthouses` | All lighthouses with birth path and stats |
| `GET /query/similar?cast_id=` | Semantic neighbors via pgvector cosine similarity |
| `GET /query/synapses?cast_id=&direction=from` | Graph edges from/to a Cast |
| `GET /query/stats` | Protocol-wide stats + sync cursor status |
| `GET /health` | Service health + all sync cursor timestamps |

## Setup

### 1. Database

Requires Postgres with pgvector extension. On Railway: provision a Postgres service, enable pgvector.

```bash
# pgvector is available on Railway's Postgres 15+ instances
# The service auto-runs the schema migration on startup
```

### 2. Environment Variables

```bash
cp .env.example .env
# Fill in DATABASE_URL
```

### 3. Run locally

```bash
npm install
npm run dev
```

### 4. Deploy to Railway

```bash
# Create new Railway service pointing at this repo
# Add DATABASE_URL from your Postgres service
# Set NODE_ENV=production
# Railway will run: npm install && npm run build && node dist/index.js
```

## Event Types (Verified from Move Source)

All event type strings were verified against `AXIOM-TIDE/CONK` protocol sources:

| Poller | Event Type | Module → Struct |
|---|---|---|
| cast-sounded | `cast::CastSounded` | `cast.move → CastSounded` |
| cast-read | `cast::CastRead` | `cast.move → CastRead` |
| cast-indexed | `drift::CastIndexed` | `drift.move → CastIndexed` |
| lighthouse-born | `cast::LighthouseBorn` | `cast.move → LighthouseBorn` |
| lighthouse-indexed | `drift::LighthouseIndexed` | `drift.move → LighthouseIndexed` |
| vessel-launched | `vessel::VesselLaunched` | `vessel.move → VesselLaunched` |

**Important note on `CastRead`:** The on-chain `CastRead` event contains only `{cast_id, read_count, read_at}` — no reader address or fee amount. Reader identity is in the transaction sender (not the event), and fee is on the Cast object. Revenue per read is inferred from `cast.fee_usdc` at index time.

## Architecture

```
Sui Mainnet (events)
       │
       ▼  [every 30s, watermark-based]
src/indexer/poller.ts
       │  ─── 6 parallel pollers, each with own cursor
       ▼
src/indexer/processors/
   cast-sounded.ts     → casts + vessels tables
   cast-read.ts        → cast_reads table
   cast-indexed.ts     → enriches casts from Drift
   lighthouse-events.ts→ lighthouses table
   vessel-launched.ts  → vessels table
       │
       ▼  [every 5min]
src/analytics/rollups.ts
       │  ─── rolling window aggregations
       ▼
Postgres (graph schema)
       │
       ▼
src/api/server.ts (Express)
   /brain.json           ← agent Cast discovery
   /.well-known/conk     ← CONK discovery doc
   /query/*              ← graph query API
   /health               ← sync status
```

## CONK Protocol Context

- **Package v13 (ACTIVE):** `0x6eca0063f930674f26a4a4593a7ef5ed487e21f31caafe74290ab5df88478cc6`
- **v13 payment model:** two-payment read — `PROTOCOL_READ_FEE ($0.001) + cast.fee_paid`. Author gets 97% of fee, protocol gets 3% + flat fee.
- **v14 note:** Native synapse references on Cast are planned for v14. The brain's synapse table will be enriched with on-chain data post-v14. For now, synapses are brain-layer only (semantic auto-links).

## What This Is NOT

This is a **knowledge graph**, not a transaction log. x402scan indexes payment flows. The brain indexes intelligence units and their connections. The primary query is "what knowledge is available and how does it relate?" not "who paid whom."
