/**
 * Webhooks (C2, C14) in the console: the list, and how the webhook forms become the attributes
 * and action metas the API takes. The server actions in `app/webhooks/actions.ts` validate what
 * these return with the contract's request schemas.
 */
import 'server-only';
import {
  WEBHOOK_REPLAY_MAX_EVENT_IDS,
  WILDCARD_EVENT,
  idSchema,
  type WebhookFailureAlert,
} from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import {
  END_BEFORE_START,
  splitList,
  utcTimestamp,
} from '../../components/integrations/filter-values';
import { SETTINGS_COPY } from '../copy/settings';
import { ActionInputError, formString, formStrings } from './action';

export const WEBHOOK_PAGE_SIZE = 25;

/** One page of the environment's webhooks. */
export function listWebhooks(api: OpenVerifyClient, after: string | undefined) {
  return api.webhooks.list({
    page: { size: WEBHOOK_PAGE_SIZE, ...(after === undefined ? {} : { after }) },
  });
}

const HEADERS_POINTER = '/data/attributes/custom-headers';

function refuse(pointer: string, detail: string): never {
  throw new ActionInputError({
    title: 'Check the values you entered',
    detail: 'Some values are not valid.',
    errors: [{ pointer, detail }],
  });
}

/**
 * The custom headers typed into the form's rows (`header-name`, `header-value`), skipping empty
 * rows. Their values are credentials: they go to the API and are never shown again.
 * @throws {ActionInputError} for a value without a name, or a name used twice.
 */
function customHeadersOf(formData: FormData): Record<string, string> {
  const names = formStrings(formData, 'header-name');
  const values = formStrings(formData, 'header-value');
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  names.forEach((rawName, index) => {
    const name = rawName.trim();
    const value = (values[index] ?? '').trim();
    if (name === '' && value === '') {
      return;
    }
    if (name === '') {
      refuse(HEADERS_POINTER, 'Give every header a name.');
    }
    if (seen.has(name.toLowerCase())) {
      refuse(HEADERS_POINTER, `Each header name can be used once (${name}).`);
    }
    seen.add(name.toLowerCase());
    headers[name] = value;
  });
  return headers;
}

/**
 * A webhook form's attributes, for `createWebhookBodySchema` or `updateWebhookBodySchema`:
 * the URL, the events (`*` alone when "all events" is chosen), the API version, the filters,
 * the attribute blocklist and, when `customHeaders` (always on create; on edit only when the
 * operator replaces them, since the stored values are never shown), the custom headers.
 * Filters and blocklist are always sent, so an edit that empties them clears them.
 * @throws {ActionInputError} for a malformed custom header row.
 */
export function webhookAttributesFromForm(
  formData: FormData,
  { customHeaders }: { readonly customHeaders: boolean },
): Record<string, unknown> {
  const headers = customHeaders ? customHeadersOf(formData) : undefined;
  const events = formStrings(formData, 'enabled-events');
  const templateIds = splitList(formString(formData, 'inquiry-template-ids'));
  const accountTypeIds = splitList(formString(formData, 'account-type-ids'));
  // C143.4 (Phase 8): the workflow, case template and list filters.
  const phase8 = Object.fromEntries(
    (['workflow-ids', 'case-template-ids', 'list-ids'] as const)
      .map((name) => [name, splitList(formString(formData, name))] as const)
      .filter(([, ids]) => ids.length > 0),
  );
  const apiVersion = formString(formData, 'api-version');
  return {
    url: formString(formData, 'url'),
    'enabled-events': events.includes(WILDCARD_EVENT) ? [WILDCARD_EVENT] : events,
    ...(apiVersion === undefined || apiVersion === '' ? {} : { 'api-version': apiVersion }),
    filters: {
      ...(templateIds.length === 0 ? {} : { 'inquiry-template-ids': templateIds }),
      ...(accountTypeIds.length === 0 ? {} : { 'account-type-ids': accountTypeIds }),
      ...phase8,
    },
    'attribute-blocklist': splitList(formString(formData, 'attribute-blocklist')),
    ...(headers === undefined ? {} : { 'custom-headers': headers }),
    // C169.5, C169.6: sent only from a form that shows them.
    ...optionalText(formData, 'name'),
    ...optionalText(formData, 'description'),
    ...(formString(formData, 'failure-alert-threshold') === undefined
      ? {}
      : { 'failure-alert': failureAlertOf(formData) }),
  };
}

const WEBHOOK_COPY = SETTINGS_COPY.webhooks;
const WHOLE = /^\d{1,5}$/;

/** A whole number from the form within its bounds, or a field refusal at `pointer`. */
function boundedOf(
  value: string | undefined,
  min: number,
  max: number,
  pointer: string,
  detail: string,
) {
  const number = WHOLE.test(value?.trim() ?? '') ? Number(value) : Number.NaN;
  if (!(number >= min && number <= max)) {
    refuse(pointer, detail);
  }
  return number;
}

/**
 * C169.6: the failure alert of a form that shows its fields: `null` when the box is unticked and
 * both numbers are empty, otherwise the three members (the box unticked keeps the numbers, off).
 * @throws {ActionInputError} for a threshold or a window outside the contract's bounds.
 */
function failureAlertOf(formData: FormData): WebhookFailureAlert | null {
  const enabled = formString(formData, 'failure-alert-enabled') === 'true';
  const threshold = formString(formData, 'failure-alert-threshold') ?? '';
  const window = formString(formData, 'failure-alert-window-minutes') ?? '';
  if (!enabled && threshold.trim() === '' && window.trim() === '') {
    return null;
  }
  return {
    enabled,
    threshold: boundedOf(
      threshold,
      1,
      10_000,
      `${ALERT_POINTER}/threshold`,
      WEBHOOK_COPY.thresholdInvalid,
    ),
    'window-minutes': boundedOf(
      window,
      5,
      1440,
      `${ALERT_POINTER}/window-minutes`,
      WEBHOOK_COPY.windowInvalid,
    ),
  };
}

const ALERT_POINTER = '/data/attributes/failure-alert';

/** An optional text field: trimmed, `null` when emptied, absent when the form does not show it. */
function optionalText(formData: FormData, name: string): Record<string, string | null> {
  const value = formString(formData, name);
  if (value === undefined) {
    return {};
  }
  const trimmed = value.trim();
  return { [name]: trimmed === '' ? null : trimmed };
}

const isEventId = (value: string) => idSchema('evt').safeParse(value).success;

/**
 * The `meta` of a replay form: the events named by ID (`replay-by=event-ids`), or those created
 * in a UTC range (`replay-by=range`), optionally only those whose delivery failed. Checked here
 * with field messages: the contract's union of the two forms would only say "Invalid input".
 * @throws {ActionInputError} naming the field to correct.
 */
export function replayMetaFromForm(formData: FormData): Record<string, unknown> {
  const replayBy = formString(formData, 'replay-by');
  if (replayBy === 'event-ids') {
    const ids = splitList(formString(formData, 'event-ids'));
    const malformed = ids.find((id) => !isEventId(id));
    if (ids.length === 0) {
      refuse('/meta/event-ids', 'Enter at least one event ID.');
    }
    if (malformed !== undefined) {
      refuse('/meta/event-ids', `${malformed} is not an event ID.`);
    }
    if (ids.length > WEBHOOK_REPLAY_MAX_EVENT_IDS) {
      refuse('/meta/event-ids', `Enter at most ${String(WEBHOOK_REPLAY_MAX_EVENT_IDS)} event IDs.`);
    }
    return { 'event-ids': ids };
  }
  if (replayBy !== 'range') {
    refuse('/replay-by', 'Choose how to select the events.');
  }
  const start = utcTimestamp(formString(formData, 'created-at-start') ?? '');
  const end = utcTimestamp(formString(formData, 'created-at-end') ?? '');
  const errors = [
    ...(start === undefined
      ? [{ pointer: '/meta/created-at-start', detail: 'Enter a date and time.' }]
      : []),
    ...(end === undefined
      ? [{ pointer: '/meta/created-at-end', detail: 'Enter a date and time.' }]
      : []),
  ];
  if (start === undefined || end === undefined) {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail: 'Some values are not valid.',
      errors,
    });
  }
  if (Date.parse(end) <= Date.parse(start)) {
    refuse('/meta/created-at-end', END_BEFORE_START);
  }
  return {
    'created-at-start': start,
    'created-at-end': end,
    ...(formString(formData, 'only-failed') === 'true' ? { status: 'failed' } : {}),
  };
}
