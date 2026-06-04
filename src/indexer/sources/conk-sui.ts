import { SuiClient } from '@mysten/sui/client';
import type { SourceProvider, FetchResult, SourceEvent } from '../source-provider.js';

const SUI_RPC = process.env.SUI_RPC || 'https://fullnode.mainnet.sui.io:443';
const CONK_PACKAGE = process.env.CONK_PACKAGE || '0x6eca0063f930674f26a4a4593a7ef5ed487e21f31caafe74290ab5df88478cc6';
const suiClient = new SuiClient({ url: SUI_RPC });

// Verified event type names from Move source (cast.move, drift.move, vessel.move)
const TYPE_MAP: Record<string, string> = {
  cast_sounded:       `${CONK_PACKAGE}::cast::CastSounded`,
  cast_read:          `${CONK_PACKAGE}::cast::CastRead`,
  cast_indexed:       `${CONK_PACKAGE}::drift::CastIndexed`,
  lighthouse_born:    `${CONK_PACKAGE}::cast::LighthouseBorn`,
  lighthouse_indexed: `${CONK_PACKAGE}::drift::LighthouseIndexed`,
  vessel_launched:    `${CONK_PACKAGE}::vessel::VesselLaunched`,
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
