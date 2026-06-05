import { SuiClient } from '@mysten/sui/client';
import type { SourceProvider, FetchResult, SourceEvent } from '../source-provider.js';

const SUI_RPC = process.env.SUI_RPC || 'https://fullnode.mainnet.sui.io:443';
const suiClient = new SuiClient({ url: SUI_RPC });

// CRITICAL: Event struct type IDs are ANCHORED to the ORIGIN package (v11 = 0x734b19fa).
// All CONK event structs were first defined in v11. Even though v13 is the active
// call-dispatch package, every emitted event has a type prefix of v11.
// Using v13 here would return 0 events — this is the most common CONK gotcha.
const EVENTS_PACKAGE =
  process.env.CONK_EVENTS_PACKAGE ||
  '0x734b19fa1696dec30f8cae38f1cdbf0ab5a12720735f7c7b0d4935cab31732cc'; // v11 — event anchor

// Verified event type names from Move source (cast.move, drift.move, vessel.move)
const TYPE_MAP: Record<string, string> = {
  cast_sounded:       `${EVENTS_PACKAGE}::cast::CastSounded`,
  cast_read:          `${EVENTS_PACKAGE}::cast::CastRead`,
  cast_indexed:       `${EVENTS_PACKAGE}::drift::CastIndexed`,
  lighthouse_born:    `${EVENTS_PACKAGE}::cast::LighthouseBorn`,
  lighthouse_indexed: `${EVENTS_PACKAGE}::drift::LighthouseIndexed`,
  vessel_launched:    `${EVENTS_PACKAGE}::vessel::VesselLaunched`,
};

export class ConkSuiSource implements SourceProvider {
  readonly sourceId = 'conk:sui:mainnet';
  readonly name = 'CONK / Sui Mainnet';

  eventTypes(): string[] { return Object.keys(TYPE_MAP); }

  async fetchEvents(eventType: string, cursor: string | null, limit: number): Promise<FetchResult> {
    const suiEventType = TYPE_MAP[eventType];
    if (!suiEventType) throw new Error(`Unknown event type: ${eventType}`);
    const parsedCursor = cursor ? JSON.parse(cursor) : undefined;
    const result = await suiClient.queryEvents({
      query: { MoveEventType: suiEventType },
      cursor: parsedCursor,
      limit,
      order: 'ascending',
    });
    return {
      events: result.data.map(e => ({
        eventId: `${e.id.txDigest}:${e.id.eventSeq}`,
        type: eventType as SourceEvent['type'],
        timestamp: e.timestampMs ? new Date(Number(e.timestampMs)) : new Date(),
        payload: { ...(e.parsedJson as Record<string, unknown> || {}), _txDigest: e.id.txDigest, _eventSeq: String(e.id.eventSeq) },
        source: this.sourceId,
      })),
      nextCursor: result.nextCursor ? JSON.stringify(result.nextCursor) : null,
      hasMore: result.hasNextPage,
    };
  }
}
