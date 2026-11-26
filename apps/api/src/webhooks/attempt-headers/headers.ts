/**
 * C169.5 (Workflow 9B; ours, mirroring the public ones): every delivery attempt says how many attempts
 * were made with this one (`openverify-webhook-attempts-made`), how many are left
 * (`openverify-webhook-attempts-left`) and when the first was made
 * (`openverify-webhook-first-attempted-at`, ISO 8601; contracts B30).
 *
 * The hook site is `attemptDelivery` in `webhooks/dispatcher.ts`, which `foundation-9b` (W) placed: the
 * headers this answers are sent after the webhook's custom headers (which may never name an
 * `openverify-` header) and before the dispatcher's own, which win. The retry schedule is unchanged:
 * 8 attempts over 24 hours (decision 52), at most the delivery's own `max_attempts`.
 *
 * Owner: `api-keys-webhooks`.
 */
import {
  WEBHOOK_ATTEMPTS_LEFT_HEADER,
  WEBHOOK_ATTEMPTS_MADE_HEADER,
  WEBHOOK_FIRST_ATTEMPTED_AT_HEADER,
} from '@openverify/contracts';

/** The attempt the dispatcher is about to make. */
export interface DeliveryAttempt {
  /** This attempt's number, from 1. */
  attempt: number;
  /** The most attempts the delivery gets (the retry schedule's length, at most its `max_attempts`). */
  maxAttempts: number;
  /** When the first attempt was made: this one's time for the first. */
  firstAttemptedAt: Date;
}

export type DeliveryAttemptHeaders = (attempt: DeliveryAttempt) => Readonly<Record<string, string>>;

export const deliveryAttemptHeaders: DeliveryAttemptHeaders = ({
  attempt,
  maxAttempts,
  firstAttemptedAt,
}) => ({
  [WEBHOOK_ATTEMPTS_MADE_HEADER]: String(attempt),
  [WEBHOOK_ATTEMPTS_LEFT_HEADER]: String(Math.max(0, maxAttempts - attempt)),
  [WEBHOOK_FIRST_ATTEMPTED_AT_HEADER]: firstAttemptedAt.toISOString(),
});
