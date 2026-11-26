/**
 * Sample event payloads for C14 `POST /webhooks/:id/simulate`, built from the golden fixtures
 * in `contracts/fixtures/api/` (synthetic data only). An event with its own fixture, such as
 * `inquiry.approved`, uses that fixture's payload. Any other event takes the fixture resource of
 * its subject (inquiry, verification, inquiry session or account; for a report event, the golden
 * report of its type, C70.4) with the status the event announces, so every C17 and C70.4 event
 * name has a sample that satisfies the event contract. Every Phase 8 event has its own fixture.
 *
 * The fixtures are read from the repository at runtime, as the dev seed reads its default
 * template, and kept in memory after the first read.
 */
import { readFile } from 'node:fs/promises';
import {
  PII_REPORT_ATTRIBUTES,
  eventDocumentSchema,
  eventPayloadSchema,
  eventResourceType,
  eventSubject,
  type EventName,
  type EventPayload,
  type EventSubject,
} from '@openverify/contracts';
import {
  INQUIRY_EVENT_BY_STATUS,
  REPORT_EVENT_NAMES,
  SELFIE_CAPTURE_EVENT_BY_STATUS,
  VERIFICATION_EVENT_BY_STATUS,
} from '@openverify/core';

/** `contracts/fixtures/api/` of the repository, from `src/webhooks/` and `dist/webhooks/`. */
export const WEBHOOK_SAMPLE_FIXTURES = new URL(
  '../../../../contracts/fixtures/api/',
  import.meta.url,
);

/** Events that have a golden event fixture of their own. */
const EVENT_FIXTURES: Partial<Record<EventName, string>> = {
  'inquiry.approved': 'event-inquiry-approved.json',
  'inquiry.completed': 'webhook-event-inquiry-completed.json',
  'account.consolidated': 'event-account-consolidated.json',
  // C112.7, C127.12, C128.6 (Workflow 8A): each with no value of its subject in it.
  'inquiry.reopened': 'event-inquiry-reopened.json',
  'inquiry.declined': 'event-inquiry-declined.json',
  'list.updated': 'event-list-updated.json',
  'workflow.published': 'event-workflow-published.json',
  'workflow.paused': 'event-workflow-paused.json',
  'workflow-version.published': 'event-workflow-version-published.json',
  'workflow-run.created': 'event-workflow-run-created.json',
  'workflow-run.resumed': 'event-workflow-run-resumed.json',
  'workflow-run.errored': 'event-workflow-run-errored.json',
  'workflow-run.completed': 'event-workflow-run-completed.json',
  'workflow-run.canceled': 'event-workflow-run-canceled.json',
  // C129.6 (Workflow 8B): each with no value of its subject in it.
  'case.created': 'event-case-created.json',
  'case.assigned': 'event-case-assigned.json',
  'case.resolved': 'event-case-resolved.json',
  'case.reopened': 'event-case-reopened.json',
  'case.status-updated': 'event-case-status-updated.json',
  'case.queue-updated': 'event-case-queue-updated.json',
  'case.updated-fields': 'event-case-updated-fields.json',
  'case.updated-tags': 'event-case-updated-tags.json',
  'case.sla-expired': 'event-case-sla-expired.json',
  'case.exported': 'event-case-exported.json',
  'case.redacted': 'event-case-redacted.json',
  'case.updated': 'event-case-updated.json',
  'case.print-initiated': 'event-case-print-initiated.json',
  'case-comment.created': 'event-case-comment-created.json',
  'case-template.deleted-field': 'event-case-template-deleted-field.json',
  // C154.8 (Workflow 9A): a version's summary and a deployment, with no flow or copy in them.
  'inquiry-template-version.created': 'event-inquiry-template-version-created.json',
  'inquiry-template-version.published': 'event-inquiry-template-version-published.json',
  'deployment.completed': 'event-deployment-completed.json',
  // C239.3 (Workflow 11A): every Connect event has its own fixture, the resource as the receiving
  // side sees it, with no shared data in it.
  'connect/connection.created': 'connect/event-connection-created.json',
  'connect/connection.activated': 'connect/event-connection-activated.json',
  'connect/connection.deactivated': 'connect/event-connection-deactivated.json',
  'connect/connection.reactivated': 'connect/event-connection-reactivated.json',
  'connect/connection.share-policy-changed': 'connect/event-connection-share-policy-changed.json',
  'connect/share-token.outbound-created': 'connect/event-share-token-outbound-created.json',
  'connect/share-token.inbound-created': 'connect/event-share-token-inbound-created.json',
  'connect/share-token.outbound-redeemed': 'connect/event-share-token-outbound-redeemed.json',
  'connect/share-token.inbound-redeemed': 'connect/event-share-token-inbound-redeemed.json',
  'connect/share-token.expired': 'connect/event-share-token-expired.json',
  'connect/share-token.failed': 'connect/event-share-token-failed.json',
  'connect/share-token.consent-withdrawn': 'connect/event-share-token-consent-withdrawn.json',
  'connect/share-token.source-redacted': 'connect/event-share-token-source-redacted.json',
  'consent-record.created': 'connect/event-consent-record-created.json',
  'consent-record.declined': 'connect/event-consent-record-declined.json',
  'consent-record.withdrawn': 'connect/event-consent-record-withdrawn.json',
};

/**
 * The resource fixture of each event subject other than `report`. A report event takes the
 * fixture of its payload's resource type, `report/<type>` → `report-<type>.json` (C70.4, F09).
 */
const RESOURCE_FIXTURES: Readonly<Record<Exclude<EventSubject, 'report'>, string>> = {
  inquiry: 'inquiry.json',
  'inquiry-session': 'inquiry-session.json',
  verification: 'verification-government-id.json',
  account: 'account.json',
  // C40.8: the server-only selfie capture resource.
  selfie: 'selfie.json',
  // C99.3 (Workflow 7B): the sample carries no value (C107.5).
  'list-match': 'list-match.json',
  // C105.3, C104.6 (Workflow 7B).
  transaction: 'transaction.json',
  'transaction-type': 'transaction-type.json',
  // C102.5 (Workflow 7B).
  'graph-query': 'graph-query.json',
  // C112.7, C127.12 (Workflow 8A): these subjects' events all have fixtures of their own.
  workflow: 'workflow.json',
  'workflow-version': 'workflow-version.json',
  'workflow-run': 'workflow-run.json',
  list: 'list.json',
  // C129.6 (Workflow 8B): these subjects' events all have fixtures of their own.
  case: 'case.json',
  'case-comment': 'case-comment.json',
  'case-template': 'case-template.json',
  // C154.8 (Workflow 9A): these subjects' events all have fixtures of their own.
  'inquiry-template-version': 'inquiry-template-version-summary.json',
  deployment: 'deployment.json',
  // C239.3 (Workflow 11A): these subjects' events all have fixtures of their own.
  'connect/connection': 'connect/connection-destination.json',
  'connect/share-token': 'connect/share-token-inbound.json',
  'consent-record': 'connect/consent-record-source-flow.json',
};

/** The golden fixture of an event's payload resource. */
function resourceFixtureOf(name: EventName, subject: EventSubject): string {
  return subject === 'report'
    ? `report-${eventResourceType(name).slice('report/'.length)}.json`
    : RESOURCE_FIXTURES[subject];
}

function inverse(map: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(map).map(([status, event]) => [event, status]));
}

/** The status each event announces, by subject; events that change no status are absent. */
const STATUS_BY_EVENT: Readonly<Record<EventSubject, ReadonlyMap<string, string>>> = {
  inquiry: inverse(INQUIRY_EVENT_BY_STATUS),
  verification: inverse(VERIFICATION_EVENT_BY_STATUS),
  'inquiry-session': new Map([
    ['inquiry-session.started', 'active'],
    ['inquiry-session.expired', 'expired'],
    ['inquiry-session.canceled', 'canceled'],
  ]),
  account: new Map([
    ['account.archived', 'archived'],
    ['account.consolidated-with', 'archived'],
    ['account.restored', 'active'],
  ]),
  selfie: inverse(SELFIE_CAPTURE_EVENT_BY_STATUS),
  // C69.2: `.ready` and `.errored` name the status; the match events leave the report ready.
  report: new Map(
    REPORT_EVENT_NAMES.flatMap((name): [string, string][] => {
      const action = name.slice(name.indexOf('.') + 1);
      return action === 'ready' || action === 'errored' ? [[name, action]] : [];
    }),
  ),
  'list-match': new Map(),
  transaction: new Map(),
  'transaction-type': new Map(),
  'graph-query': new Map([
    ['graph-query.submitted', 'submitted'],
    ['graph-query.completed', 'completed'],
    ['graph-query.errored', 'errored'],
    ['graph-query.cancelled', 'cancelled'],
    ['graph-query.timed-out', 'timed_out'],
    ['graph-query.reran', 'submitted'],
  ]),
  workflow: new Map(),
  'workflow-version': new Map(),
  'workflow-run': new Map(),
  list: new Map(),
  case: new Map(),
  'case-comment': new Map(),
  'case-template': new Map(),
  // C154.8 (Workflow 9A): no status announced.
  'inquiry-template-version': new Map(),
  deployment: new Map(),
  // C239.3 (Workflow 11A): each event's own fixture holds its status.
  'connect/connection': new Map(),
  'connect/share-token': new Map(),
  'consent-record': new Map(),
};

/** C105.3, C104.6: the meta of the transaction relation and type events. */
const SAMPLE_ACCOUNT = 'acc_01M5CK3190XEVBM5ZXA76E1JSN';
const EVENT_META: Partial<Record<EventName, Record<string, unknown>>> = {
  'transaction.added-relation': {
    context: { 'relation-schema-key': 'buyer', 'related-account-id': SAMPLE_ACCOUNT },
  },
  'transaction.removed-relation': {
    context: { 'relation-schema-key': 'buyer', 'related-account-id': SAMPLE_ACCOUNT },
  },
  'transaction-type.deleted-field': { 'field-key': 'amount', 'version-number': 2 },
  'transaction-type.converted-field': {
    'field-key': 'amount',
    'version-number': 2,
    from: 'number',
    to: 'integer',
  },
};

/** `inquiry.transitioned` carries `payload.meta: { from, to }` (C10). */
const TRANSITION = { from: 'pending', to: 'completed' } as const;

export interface WebhookSampleSource {
  /**
   * A sample payload for `name`, validated against the event contract. Each call returns a
   * new copy.
   * @throws when the fixtures cannot be read or no longer satisfy the contract.
   */
  payloadFor(name: EventName): Promise<EventPayload>;
}

type Attributes = Record<string, unknown>;

/** A synthetic API key, the reviewer of the `.reviewed` samples. */
const SAMPLE_REVIEWER = 'key_01M5CJXHG0RVK7X4H9941FSM5K';

/**
 * A report event's sample (C70.4): `.errored` carries an error; `.redacted` nulls the report's
 * PII attributes (C73.5) and ends its monitoring; `.dismissed` and `.reviewed` name a match of
 * the fixture in `meta`.
 */
function reportSample(name: EventName, attributes: Attributes): { meta?: Record<string, unknown> } {
  if (name.endsWith('.errored')) {
    attributes.errors = [{ code: 'execution_error' }];
  }
  if (name.endsWith('.redacted')) {
    attributes['redacted-at'] = attributes['completed-at'] ?? attributes['created-at'];
    for (const member of PII_REPORT_ATTRIBUTES) {
      if (member in attributes) {
        attributes[member] = null;
      }
    }
    attributes['next-run-at'] = null;
    attributes['is-recurring'] = false;
  }
  const matches = Array.isArray(attributes.matches) ? (attributes.matches as Attributes[]) : [];
  const match = typeof matches[0]?.id === 'string' ? matches[0].id : undefined;
  if (name.endsWith('.dismissed') && match !== undefined) {
    return { meta: { 'match-ids': [match] } };
  }
  if (name.endsWith('.reviewed') && match !== undefined) {
    return {
      meta: {
        'review-type': 'record',
        'review-status': 'true_positive',
        'risk-level': 'material',
        'record-token': match,
        reviewer: SAMPLE_REVIEWER,
      },
    };
  }
  return {};
}

/**
 * The resource with the status and redaction the event implies, with the fixture's `included`
 * resources (C91: a session's network row) unless the event redacts.
 */
function sampleFor(
  name: EventName,
  subject: EventSubject,
  data: Attributes,
  included?: readonly unknown[],
): EventPayload {
  const attributes = { ...(data.attributes as Attributes) };
  const status =
    name === 'inquiry.transitioned' ? TRANSITION.to : STATUS_BY_EVENT[subject].get(name);
  if (status !== undefined) {
    attributes.status = status;
  }
  if (subject === 'report') {
    const { meta } = reportSample(name, attributes);
    return eventPayloadSchema.parse({
      data: { ...data, attributes },
      ...(meta === undefined ? {} : { meta }),
    });
  }
  if (subject === 'list-match') {
    // Rule 11 (C107.5): an event never carries the matched value or a dismissal's reason.
    attributes['matched-value'] = null;
    attributes.reason = null;
  }
  if (subject === 'transaction') {
    // Rule 11 (C107.5): an event never carries a transaction's field values.
    attributes.fields = null;
    if (name === 'transaction.redacted') {
      attributes['redacted-at'] = attributes['updated-at'];
    }
    return eventPayloadSchema.parse({
      data: { ...data, attributes },
      ...(EVENT_META[name] === undefined ? {} : { meta: EVENT_META[name] }),
    });
  }
  if (subject === 'graph-query') {
    // Rule 11 (C107.5): an event never carries a query's parameters or its nodes.
    Object.assign(attributes, { params: null, nodes: [], links: [] });
    attributes['completed-at'] = status === 'completed' ? attributes['completed-at'] : null;
    attributes['errored-at'] = status === 'errored' ? attributes['created-at'] : null;
    return eventPayloadSchema.parse({ data: { ...data, attributes } });
  }
  if (subject === 'transaction-type') {
    return eventPayloadSchema.parse({ data, meta: EVENT_META[name] });
  }
  if (name.endsWith('.redacted')) {
    attributes['redacted-at'] = attributes['updated-at'];
    attributes.fields = {};
    if ('note' in attributes) {
      attributes.note = null;
    }
  }
  return eventPayloadSchema.parse({
    data: { ...data, attributes },
    ...(included === undefined || name.endsWith('.redacted') ? {} : { included }),
    ...(name === 'inquiry.transitioned' ? { meta: { ...TRANSITION } } : {}),
  });
}

/** Samples from the fixtures in `directory` (a `file:` URL ending in `/`). */
export function createFixtureSampleSource(
  directory: URL = WEBHOOK_SAMPLE_FIXTURES,
): WebhookSampleSource {
  const files = new Map<string, Promise<unknown>>();
  const read = (file: string): Promise<unknown> => {
    let pending = files.get(file);
    if (pending === undefined) {
      pending = readFile(new URL(file, directory), 'utf8').then((text): unknown =>
        JSON.parse(text),
      );
      // A failed read is not cached, so a later call can succeed.
      pending.catch(() => files.delete(file));
      files.set(file, pending);
    }
    return pending.then((value) => structuredClone(value));
  };

  return {
    async payloadFor(name) {
      const eventFile = EVENT_FIXTURES[name];
      if (eventFile !== undefined) {
        return eventDocumentSchema.parse(await read(eventFile)).data.attributes
          .payload as EventPayload;
      }
      const subject = eventSubject(name);
      const document = (await read(resourceFixtureOf(name, subject))) as {
        data: Attributes;
        included?: readonly unknown[];
      };
      return sampleFor(name, subject, document.data, document.included);
    },
  };
}
