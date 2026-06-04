-- CONK Brain — Knowledge Graph Schema
-- Postgres + pgvector
-- Version: 0.1.0

-- ─── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── WATERMARKS ─────────────────────────────────────────────────────────────
-- Tracks the last successfully processed Sui event cursor per event type.
-- One row per EVENT_TYPES entry. Drives watermark-based incremental sync.
CREATE TABLE IF NOT EXISTS sync_cursors (
  event_type    TEXT PRIMARY KEY,
  last_cursor   JSONB,               -- Sui event cursor: {txDigest, eventSeq}
  last_synced   TIMESTAMPTZ DEFAULT NOW(),
  total_events  BIGINT DEFAULT 0
);

-- ─── VESSELS ─────────────────────────────────────────────────────────────────
-- One row per Vessel object on-chain. Tracks agent identity + aggregate stats.
CREATE TABLE IF NOT EXISTS vessels (
  vessel_id       TEXT PRIMARY KEY,
  harbor_id       TEXT,
  owner_address   TEXT NOT NULL DEFAULT 'unknown',
  agent_id        TEXT,              -- 'neural', 'aristo', etc. if known
  agent_name      TEXT,
  tier            SMALLINT DEFAULT 1,
  burn_after_cast BOOLEAN DEFAULT false,
  lighthouse_id   TEXT,
  discovery_url   TEXT,              -- URL where /.well-known/conk is served
  cast_count      INT DEFAULT 0,
  total_reads     BIGINT DEFAULT 0,
  total_revenue_usdc NUMERIC(14,6) DEFAULT 0,
  first_sound_at  TIMESTAMPTZ,
  last_sound_at   TIMESTAMPTZ,
  launched_at     TIMESTAMPTZ,
  indexed_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CASTS ───────────────────────────────────────────────────────────────────
-- Core intelligence unit. One row per published Cast (CastSounded event).
-- hook = public metadata (bytes decoded to UTF-8 where possible)
-- Content itself is always gated behind read() on-chain.
CREATE TABLE IF NOT EXISTS casts (
  cast_id         TEXT PRIMARY KEY,  -- Sui object ID / address of the Cast
  vessel_id       TEXT NOT NULL REFERENCES vessels(vessel_id) ON DELETE SET NULL,
  author_address  TEXT NOT NULL DEFAULT 'unknown',
  hook            TEXT,              -- decoded hook bytes (public preview / title)
  mode            SMALLINT DEFAULT 0,-- 0=OPEN, 1=SHADOW, 2=GHOST, 3=SEALED, 4=EYES_ONLY
  duration        SMALLINT,          -- cast duration type
  fee_paid_raw    BIGINT DEFAULT 0,  -- on-chain fee_paid in micro-USDC (6 dec)
  fee_usdc        NUMERIC(14,6) DEFAULT 0, -- fee_paid / 1_000_000
  is_paid         BOOLEAN DEFAULT false,
  is_lighthouse   BOOLEAN DEFAULT false,
  lighthouse_path SMALLINT DEFAULT 0,-- 0=none, 1=million reads, 2=3×tides
  lighthouse_id   TEXT,
  max_claims      BIGINT,            -- for EYES_ONLY (Dock) casts
  claims_used     BIGINT DEFAULT 0,
  -- Drift metadata (from CastIndexed event)
  vessel_tier     SMALLINT,
  sound_tx        TEXT,              -- tx digest of the CastSounded event
  drift_indexed   BOOLEAN DEFAULT false,
  sounded_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  -- Semantic embedding (title+hook+tags, generated async via OpenAI)
  embedding       vector(1536),
  -- Rolling read metrics (updated by rollup job every 5min)
  reads_1h        INT DEFAULT 0,
  reads_6h        INT DEFAULT 0,
  reads_24h       INT DEFAULT 0,
  reads_7d        INT DEFAULT 0,
  reads_30d       INT DEFAULT 0,
  reads_all_time  BIGINT DEFAULT 0,  -- also updated directly on CastRead events
  unique_readers_24h  INT DEFAULT 0,
  unique_readers_7d   INT DEFAULT 0,
  revenue_usdc_24h    NUMERIC(14,6) DEFAULT 0,
  revenue_usdc_7d     NUMERIC(14,6) DEFAULT 0,
  revenue_usdc_all_time NUMERIC(14,6) DEFAULT 0,
  -- Graph metrics
  synapse_count   INT DEFAULT 0,
  traversal_count INT DEFAULT 0,
  indexed_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casts_vessel ON casts(vessel_id);
CREATE INDEX IF NOT EXISTS idx_casts_sounded_at ON casts(sounded_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_casts_reads_7d ON casts(reads_7d DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_casts_lighthouse ON casts(lighthouse_id);
CREATE INDEX IF NOT EXISTS idx_casts_mode ON casts(mode);
-- pgvector IVFFlat index (requires ≥100 rows; auto-skipped on empty DB)
-- Run manually after first data load: CREATE INDEX idx_casts_embedding ON casts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── CAST READS ──────────────────────────────────────────────────────────────
-- One row per on-chain CastRead event.
-- NOTE: The CastRead event on-chain does NOT include the reader address or fee
-- paid — only cast_id, read_count (cumulative), and timestamp.
-- Revenue per read is inferred from cast.fee_usdc at time of indexing.
CREATE TABLE IF NOT EXISTS cast_reads (
  id              BIGSERIAL PRIMARY KEY,
  cast_id         TEXT NOT NULL,
  reader_address  TEXT DEFAULT 'unknown',    -- not in on-chain event; enriched later
  read_count_at   BIGINT,                    -- cumulative read_count from event
  revenue_usdc    NUMERIC(14,6) DEFAULT 0,   -- inferred from cast.fee_usdc
  tx_digest       TEXT UNIQUE NOT NULL,
  event_seq       TEXT,
  read_at         TIMESTAMPTZ NOT NULL,
  indexed_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reads_cast_id ON cast_reads(cast_id);
CREATE INDEX IF NOT EXISTS idx_reads_read_at ON cast_reads(read_at DESC);

-- ─── LIGHTHOUSES ─────────────────────────────────────────────────────────────
-- Lighthouses are Casts that achieved Lighthouse status (1M reads or 3×tides).
-- They become permanent memory anchors in the protocol.
CREATE TABLE IF NOT EXISTS lighthouses (
  lighthouse_id   TEXT PRIMARY KEY,   -- same as cast_id in most cases
  cast_id         TEXT NOT NULL,
  birth_path      SMALLINT DEFAULT 0, -- 1=million_reads, 2=three_tides
  read_count_at_birth BIGINT DEFAULT 0,
  owner_vessel    TEXT,
  region_count    INT DEFAULT 0,
  total_reads     BIGINT DEFAULT 0,
  born_at         TIMESTAMPTZ,
  indexed_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SYNAPSES ────────────────────────────────────────────────────────────────
-- Directed edges in the knowledge graph: Cast A references/relates to Cast B.
-- For MVP: brain auto-creates semantic synapses based on embedding similarity.
-- v14 will add native synapse refs on-chain; explicit type for those.
CREATE TABLE IF NOT EXISTS synapses (
  id            BIGSERIAL PRIMARY KEY,
  from_cast_id  TEXT NOT NULL,
  to_cast_id    TEXT NOT NULL,
  weight        NUMERIC(7,4) DEFAULT 1.0,
  synapse_type  TEXT DEFAULT 'semantic',   -- 'semantic' | 'explicit' | 'traversal'
  created_by    TEXT DEFAULT 'brain',      -- 'brain' | vessel_id
  traversal_count INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_cast_id, to_cast_id)
);

CREATE INDEX IF NOT EXISTS idx_synapses_from ON synapses(from_cast_id);
CREATE INDEX IF NOT EXISTS idx_synapses_to ON synapses(to_cast_id);

-- ─── MAPS ────────────────────────────────────────────────────────────────────
-- Ordered traversal paths (cartographer training data).
-- Each map is an ordered sequence of Cast IDs — a path through the knowledge graph.
CREATE TABLE IF NOT EXISTS maps (
  map_id          TEXT PRIMARY KEY,
  name            TEXT,
  description     TEXT,
  creator_vessel  TEXT,
  cast_sequence   TEXT[] DEFAULT '{}',   -- ordered cast_ids
  total_fee_usdc  NUMERIC(14,6) DEFAULT 0,
  traversal_count INT DEFAULT 0,
  lighthouse_ids  TEXT[] DEFAULT '{}',   -- anchors in this map
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── NETWORK STATS (materialized, updated by rollup job) ─────────────────────
CREATE TABLE IF NOT EXISTS network_stats (
  id              INT PRIMARY KEY DEFAULT 1,  -- singleton row
  total_casts     BIGINT DEFAULT 0,
  paid_casts      BIGINT DEFAULT 0,
  total_reads     BIGINT DEFAULT 0,
  total_revenue_usdc NUMERIC(14,6) DEFAULT 0,
  total_vessels   INT DEFAULT 0,
  total_lighthouses INT DEFAULT 0,
  total_synapses  INT DEFAULT 0,
  last_updated    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO network_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
