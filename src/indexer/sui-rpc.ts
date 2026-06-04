import { SuiClient } from '@mysten/sui/client';
import { SUI_RPC } from '../config/index.js';

export const suiClient = new SuiClient({ url: SUI_RPC });

export interface SuiCursor {
  txDigest: string;
  eventSeq: string;
}

/**
 * Query events from Sui with watermark-based pagination.
 * Returns all events of the given type after the cursor.
 */
export async function queryEvents(
  eventType: string,
  cursor: SuiCursor | null,
  limit = 50
) {
  const result = await suiClient.queryEvents({
    query: { MoveEventType: eventType },
    cursor: cursor ?? undefined,
    limit,
    order: 'ascending',
  });
  return result;
}

/**
 * Fetch a Sui object by ID and return its parsed fields.
 */
export async function getObject(objectId: string) {
  const result = await suiClient.getObject({
    id: objectId,
    options: { showContent: true, showType: true },
  });
  return result;
}

/**
 * Decode a Sui Move vector<u8> hook field.
 * Sui returns bytes as an array of numbers. Decode to UTF-8 string.
 */
export function decodeHook(hookRaw: unknown): string {
  try {
    if (typeof hookRaw === 'string') return hookRaw;
    if (Array.isArray(hookRaw)) {
      const bytes = Uint8Array.from(hookRaw as number[]);
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  } catch {
    // ignore decode errors
  }
  return '';
}

/**
 * Parse a Sui timestamp (milliseconds since epoch) to ISO string.
 */
export function parseTimestamp(tsMs: unknown): string {
  const n = Number(tsMs);
  if (!n || isNaN(n)) return new Date().toISOString();
  return new Date(n).toISOString();
}
