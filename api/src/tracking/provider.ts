/**
 * The integration point for a carrier tracking API - not wired to one yet.
 *
 * A `stepLot` call against a `forward`-flagged step stores a `trackingId` and
 * `shipper` on the `StageEvent` (shared/models.ts). This is where those two
 * become the carrier's own events, once a provider exists to ask: one
 * interface, so no route or provider name is hard-coded into the timeline
 * that reads from it.
 */
export interface ExternalTrackingEvent {
  at: string;
  status: string;
  description?: string;
  location?: string;
}

export interface TrackingProvider {
  /** Look up what a carrier says has happened to one shipment. */
  fetchEvents(trackingId: string, shipper: string): Promise<ExternalTrackingEvent[]>;
}

/** Returns nothing, on purpose: no provider is connected yet. */
class NoopTrackingProvider implements TrackingProvider {
  async fetchEvents(): Promise<ExternalTrackingEvent[]> {
    return [];
  }
}

let cached: TrackingProvider | null = null;

/**
 * Resolve the configured tracking provider.
 *
 * Swap the body of this function for a real client (Shippo, AfterShip, a
 * carrier's own API) when one is chosen - callers only ever see
 * `TrackingProvider`, so nothing that reads `fetchEvents` changes.
 */
export function getTrackingProvider(): TrackingProvider {
  if (!cached) cached = new NoopTrackingProvider();
  return cached;
}
