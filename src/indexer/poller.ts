/**
 * CONK Brain — Event Poller
 *
 * Watermark-based incremental sync of Sui events.
 * One poller per event type. Each poller:
 *   1. Reads its cursor from sync_cursors
 *   2. Fetches events since cursor (ascending, batched)
 *   3. Processes each event through its processor
 *   4. Updates the cursor after each batch
 *   5. Repeats on interval
 */

import { queryEvents, type SuiCursor } from './sui-rpc.js';
import { getWatermark, setWatermark } from './watermark.js';
import { processCastSounded }      from './processors/cast-sounded.js';
import { processCastRead }         from './processors/cast-read.js';
import { processCastIndexed }      from './processors/cast-indexed.js';
import { processLighthouseBorn, processLighthouseIndexed } from './processors/lighthouse-events.js';
import { processVesselLaunched }   from './processors/vessel-launched.js';
import { EVENT_TYPES, POLL_INTERVAL_MS, BATCH_SIZE } from '../config/index.js';

type Processor = (event: any) => Promise<void>;

interface PollerConfig {
  name: string;
  eventType: string;
  processor: Processor;
}

const POLLERS: PollerConfig[] = [
  // Primary: Cast published
  { name: 'cast-sounded',       eventType: EVENT_TYPES.CAST_SOUNDED,       processor: processCastSounded },
  // Primary: Cast read (tracks cumulative read counts)
  { name: 'cast-read',          eventType: EVENT_TYPES.CAST_READ,          processor: processCastRead },
  // Drift feed index (enriches casts with hook + tier from Drift's perspective)
  { name: 'cast-indexed',       eventType: EVENT_TYPES.CAST_INDEXED,       processor: processCastIndexed },
  // Lighthouse events
  { name: 'lighthouse-born',    eventType: EVENT_TYPES.LIGHTHOUSE_BORN,    processor: processLighthouseBorn },
  { name: 'lighthouse-indexed', eventType: EVENT_TYPES.LIGHTHOUSE_INDEXED, processor: processLighthouseIndexed },
  // Vessel lifecycle
  { name: 'vessel-launched',    eventType: EVENT_TYPES.VESSEL_LAUNCHED,    processor: processVesselLaunched },
];

async function runPoller(config: PollerConfig): Promise<void> {
  const { name, eventType, processor } = config;
  let cursor: SuiCursor | null = null;

  try {
    cursor = await getWatermark(eventType);
  } catch (err: any) {
    console.error(`[brain][${name}] Failed to read watermark:`, err.message);
    return;
  }

  let currentCursor = cursor;
  let totalProcessed = 0;
  let hasMore = true;

  while (hasMore) {
    let result: Awaited<ReturnType<typeof queryEvents>>;
    try {
      result = await queryEvents(eventType, currentCursor, BATCH_SIZE);
    } catch (err: any) {
      console.error(`[brain][${name}] RPC error:`, err.message);
      break;
    }

    const events = result.data;
    if (events.length === 0) break;

    for (const event of events) {
      try {
        await processor(event);
      } catch (err: any) {
        console.error(
          `[brain][${name}] Error processing event ${event.id?.txDigest}:`,
          err.message
        );
        // Continue — don't let one bad event block the whole batch
      }
    }

    totalProcessed += events.length;

    if (result.nextCursor) {
      currentCursor = result.nextCursor as SuiCursor;
    }
    hasMore = result.hasNextPage ?? false;

    // Persist cursor after each batch to avoid reprocessing on restart
    if (currentCursor && events.length > 0) {
      try {
        await setWatermark(eventType, currentCursor, events.length);
      } catch (err: any) {
        console.error(`[brain][${name}] Failed to save watermark:`, err.message);
      }
    }
  }

  if (totalProcessed > 0) {
    console.log(`[brain][${name}] +${totalProcessed} events processed`);
  }
}

async function runAllPollers(): Promise<void> {
  // Run all pollers concurrently — each has its own watermark and is independent
  const results = await Promise.allSettled(
    POLLERS.map(p => runPoller(p))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      console.error(`[brain][poller:${POLLERS[i].name}] Fatal error:`, result.reason);
    }
  }
}

export function startPollers(): void {
  console.log(`[brain] Starting ${POLLERS.length} event pollers (interval: ${POLL_INTERVAL_MS}ms)`);
  for (const p of POLLERS) {
    console.log(`[brain]   → ${p.name}: ${p.eventType}`);
  }

  // Run immediately on startup (catches up from last watermark)
  runAllPollers().catch(err => console.error('[brain][pollers] Initial run error:', err));

  // Then poll on interval
  setInterval(() => {
    runAllPollers().catch(err => console.error('[brain][pollers] Poll error:', err));
  }, POLL_INTERVAL_MS);
}
