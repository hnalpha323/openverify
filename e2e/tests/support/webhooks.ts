/**
 * Reading OpenVerify webhook deliveries the way a customer's endpoint does: verify the
 * signature over the raw body first, then parse the event (C5).
 */
import { eventDocumentSchema, type EventDocument } from '@openverify/contracts';
import { OPENVERIFY_SIGNATURE_HEADER, verifyWebhookSignature } from '@openverify/node';
import type { RecordedRequest, WebhookReceiver } from '../../src/webhook-receiver.js';

export interface Delivery {
  request: RecordedRequest;
  event: EventDocument['data'];
}

function eventOf(request: RecordedRequest): EventDocument['data'] | null {
  try {
    const parsed = eventDocumentSchema.safeParse(JSON.parse(request.body));
    return parsed.success ? parsed.data.data : null;
  } catch {
    return null;
  }
}

/** Waits for the delivery of `eventName` about `resourceId` (the resource in its payload). */
export async function waitForEvent(
  receiver: WebhookReceiver,
  eventName: string,
  resourceId: string,
  timeoutMs = 120_000,
): Promise<Delivery> {
  const request = await receiver.waitFor(
    (candidate) => {
      const event = eventOf(candidate);
      return (
        event?.attributes.name === eventName && event.attributes.payload.data.id === resourceId
      );
    },
    { timeoutMs, description: `${eventName} for ${resourceId}` },
  );
  const event = eventOf(request);
  if (event === null) {
    throw new Error('The matched delivery no longer parses');
  }
  return { request, event };
}

/**
 * Verifies the `openverify-signature` header with `@openverify/node`, exactly as a customer
 * would, and returns the signed timestamp.
 * @throws {WebhookSignatureError} when the signature does not verify.
 */
export function verifyDelivery(delivery: Delivery, secret: string): number {
  return verifyWebhookSignature({
    body: delivery.request.body,
    header: delivery.request.headers[OPENVERIFY_SIGNATURE_HEADER],
    secrets: secret,
  }).timestamp;
}

/** The names of every event delivered about `resourceId`, in arrival order. */
export function eventNamesFor(receiver: WebhookReceiver, resourceId: string): string[] {
  return receiver.requests
    .map(eventOf)
    .filter((event) => event?.attributes.payload.data.id === resourceId)
    .map((event) => event?.attributes.name ?? '');
}
