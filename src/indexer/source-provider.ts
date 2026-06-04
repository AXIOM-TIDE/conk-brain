export interface SourceEvent {
  eventId: string;
  type: 'cast_sounded' | 'cast_read' | 'vessel_launched' | 'lighthouse_born' | 'cast_indexed' | 'lighthouse_indexed';
  timestamp: Date;
  payload: Record<string, unknown>;
  source: string;
}

export interface FetchResult {
  events: SourceEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SourceProvider {
  readonly sourceId: string;
  readonly name: string;
  fetchEvents(eventType: string, cursor: string | null, limit: number): Promise<FetchResult>;
  eventTypes(): string[];
}

export interface EventProcessor {
  handles: string[];
  process(event: SourceEvent): Promise<void>;
}
