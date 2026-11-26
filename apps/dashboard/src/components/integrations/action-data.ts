/**
 * What the integrations server actions answer (`app/webhooks/actions.ts`,
 * `app/api-keys/actions.ts`), in a module both the actions and the client components import.
 * Secrets in these live only in the one-time secret dialog that shows them (C21).
 */

/** A new webhook (created or cloned) and its signing secret, shown once. */
export interface CreatedWebhook {
  readonly id: string;
  readonly secret: string;
}

/** A rotated signing secret, shown once, and until when the previous one also signs. */
export interface RotatedSecret {
  readonly secret: string;
  readonly previousSecretExpiresAt: string;
}

/** The sample event a webhook was sent. */
export interface SimulatedEvent {
  readonly eventId: string;
}

/** How many events a replay delivers again. */
export interface ReplayedEvents {
  readonly replayedCount: number;
}

/** A new API key (created or cloned) and its token, shown once. */
export interface CreatedApiKey {
  readonly id: string;
  /** Named `secret` so the one-time secret components take it as they take a webhook secret. */
  readonly secret: string;
  /** When a created key expires (C25.5: set in the same call); `null` when it never does. */
  readonly expiresAt?: string | null;
}

/** C169.1: a rotation's new key and its token (shown once), and when the old token stops working. */
export interface RotatedApiKeyData {
  readonly id: string;
  readonly secret: string;
  readonly previousExpiresAt: string;
}
