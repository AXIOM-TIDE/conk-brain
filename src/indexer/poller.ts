import { getWatermark, setWatermark } from './watermark.js';
import { ConkSuiSource } from './sources/conk-sui.js';
import { processSoundEvent } from './processors/sound-event.js';
import { processReadEvent } from './processors/read-event.js';
import type { SourceProvider, EventProcessor, SourceEvent } from './source-provider.js';
import { pool } from '../db/pool.js';

const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000');

// ── SOURCE REGISTRY — add new chains here, never touch the loop ──────────────
const SOURCES: SourceProvider[] = [
  new ConkSuiSource(),
  // new X402BaseSource(),  ← future
];

// ── PROCESSOR REGISTRY ────────────────────────────────────────────────────────
const PROCESSORS: EventProcessor[] = [
  { handles: ['cast_sounded', 'cast_indexed'], process: processSoundEvent },
  { handles: ['cast_read'], process: processReadEvent },
  {
    handles: ['vessel_launched'],
    process: async (e: SourceEvent) => {
      const vesselId = e.payload.vessel_id as string || e.payload.id as string;
      if (!vesselId) return;
      await pool.query(`
        INSERT INTO vessels (vessel_id, owner_address) VALUES ($1,'unknown')
        ON CONFLICT (vessel_id) DO NOTHING
      `, [vesselId]);
    },
  },
  {
    handles: ['lighthouse_born', 'lighthouse_indexed'],
    process: async (e: SourceEvent) => {
      const lhId = e.payload.lighthouse_id as string || e.payload.id as string;
      if (!lhId) return;
      await pool.query(`
        INSERT INTO lighthouses (lighthouse_id, name, owner_address)
        VALUES ($1,$2,'unknown') ON CONFLICT (lighthouse_id) DO NOTHING
      `, [lhId, e.payload.name as string || null]);
    },
  },
];

async function pollOne(source: SourceProvider, eventType: string): Promise<void> {
  const key = `${source.sourceId}:${eventType}`;
  try {
    const cursor = await getWatermark(key);
    let cur = cursor; let total = 0; let hasMore = true;
    while (hasMore) {
      const result = await source.fetchEvents(eventType, cur, BATCH_SIZE);
      if (!result.events.length) break;
      const procs = PROCESSORS.filter(p => p.handles.includes(eventType));
      for (const ev of result.events) {
        for (const p of procs) { try { await p.process(ev); } catch(err) { console.error(`[brain] proc error`, err); } }
      }
      total += result.events.length;
      if (result.nextCursor) cur = result.nextCursor;
      hasMore = result.hasMore;
    }
    if (cur && total > 0) { await setWatermark(key, cur, total); console.log(`[brain][${source.name}][${eventType}] +${total}`); }
  } catch(err) { console.error(`[brain][${key}] poll error:`, err); }
}

export async function startPollers(): Promise<void> {
  const runAll = () => Promise.allSettled(SOURCES.flatMap(s => s.eventTypes().map(t => pollOne(s, t))));
  console.log(`[brain] Starting ${SOURCES.length} source(s), ${SOURCES.flatMap(s=>s.eventTypes()).length} event type(s)`);
  await runAll();
  setInterval(runAll, POLL_INTERVAL_MS);
}
