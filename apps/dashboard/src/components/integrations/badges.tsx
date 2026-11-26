import type { WebhookDeliveryStatus, WebhookStatus } from '@openverify/contracts';
import { Badge, type BadgeTone } from '../status-badge';

type Tone = BadgeTone;

const WEBHOOK: Record<WebhookStatus, { label: string; tone: Tone }> = {
  enabled: { label: 'Enabled', tone: 'success' },
  disabled: { label: 'Disabled', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export function WebhookStatusBadge({ status }: { readonly status: WebhookStatus }) {
  return <Badge status={status} {...WEBHOOK[status]} />;
}

const DELIVERY: Record<WebhookDeliveryStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'progress' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const DELIVERY_STATUS_LABELS: Readonly<Record<WebhookDeliveryStatus, string>> = {
  pending: DELIVERY.pending.label,
  succeeded: DELIVERY.succeeded.label,
  failed: DELIVERY.failed.label,
};

export function DeliveryStatusBadge({ status }: { readonly status: WebhookDeliveryStatus }) {
  return <Badge status={status} {...DELIVERY[status]} />;
}

/** An API key without an expiry, with one ahead, or past it. */
export type ApiKeyBadgeState = 'active' | 'expiring' | 'expired';

const API_KEY: Record<ApiKeyBadgeState, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  expiring: { label: 'Expires', tone: 'attention' },
  expired: { label: 'Expired', tone: 'neutral' },
};

export function ApiKeyStateBadge({ state }: { readonly state: ApiKeyBadgeState }) {
  return <Badge status={state} {...API_KEY[state]} />;
}

function httpTone(status: number): Tone {
  if (status >= 500) {
    return 'danger';
  }
  if (status >= 400) {
    return 'attention';
  }
  return status >= 200 && status < 300 ? 'success' : 'neutral';
}

/** An HTTP response status, coloured by class. */
export function HttpStatusBadge({ status }: { readonly status: number }) {
  return <Badge status={String(status)} label={String(status)} tone={httpTone(status)} />;
}
