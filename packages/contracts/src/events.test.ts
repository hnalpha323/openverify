import { describe, expect, it } from 'vitest';
import { buildAccountResource } from './accounts.js';
import {
  buildEventResource,
  eventDocumentSchema,
  eventListDocumentSchema,
  eventPayloadSchema,
  eventResourceSchema,
  listEventsQuerySchema,
  redactedEventPayloadSchema,
  redactedResourceStubSchema,
  storedEventPayloadSchema,
} from './events.js';
import { buildInquiryResource } from './inquiries.js';
import { buildInquirySessionResource } from './inquiry-sessions.js';
import {
  INQUIRY_EVENT_NAMES,
  LIST_EVENT_NAMES,
  CASE_COMMENT_EVENT_NAMES,
  CASE_EVENT_NAMES,
  CASE_TEMPLATE_EVENT_NAMES,
  WORKFLOW_EVENT_NAMES,
  WORKFLOW_RUN_EVENT_NAMES,
  WORKFLOW_VERSION_EVENT_NAMES,
  eventSubject,
  eventResourceType,
  isEventName,
  type EventName,
} from './event-names.js';
import { LIST_UPDATE_CHANGE_KINDS, listUpdatedMetaSchema } from './lists.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO, LATEST, readFixture } from './test-support.js';
import { buildVerificationResource } from './verifications.js';

const inquiry = buildInquiryResource({
  id: IDS.inquiry,
  status: 'completed',
  referenceId: 'ref-test-001',
  fields: {},
  inquiryTemplateId: IDS.template,
  verifications: [{ id: IDS.selfie, type: 'selfie' }],
  createdAt: AT,
  updatedAt: LATER,
});

const verification = buildVerificationResource({
  id: IDS.selfie,
  type: 'selfie',
  status: 'passed',
  inquiryId: IDS.inquiry,
  fileIds: [],
  checks: [],
  createdAt: AT,
  updatedAt: LATER,
});

describe('event resource (C5)', () => {
  const event = {
    type: 'event',
    id: IDS.event,
    attributes: {
      name: 'inquiry.completed',
      payload: { data: inquiry, included: [verification] },
      'created-at': LATER_ISO,
    },
  };

  it('wraps the affected resource in its payload', () => {
    expect(eventResourceSchema.parse(event)).toEqual(event);
  });

  it('is the webhook delivery body when wrapped in data', () => {
    expect(eventDocumentSchema.parse({ data: event })).toEqual({ data: event });
  });

  it('carries verification resources for verification events', () => {
    const value = {
      ...event,
      attributes: {
        ...event.attributes,
        name: 'verification.passed',
        payload: { data: verification },
      },
    };
    expect(eventResourceSchema.safeParse(value).success).toBe(true);
  });

  it('rejects a payload that does not match the event name', () => {
    const value = {
      ...event,
      attributes: { ...event.attributes, name: 'verification.passed' },
    };
    const result = eventResourceSchema.safeParse(value);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'attributes.payload.data.type',
    ]);
  });

  it('rejects events outside the catalog', () => {
    const value = { ...event, attributes: { ...event.attributes, name: 'inquiry.deleted' } };
    expect(eventResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from an event record', () => {
    expect(
      buildEventResource({
        id: IDS.event,
        name: 'inquiry.completed',
        payload: { data: inquiry, included: [verification] },
        createdAt: LATER,
      }),
    ).toEqual(event);
  });

  it('refuses to build a mismatched event', () => {
    expect(() =>
      buildEventResource({
        id: IDS.event,
        name: 'verification.created',
        payload: { data: inquiry },
        createdAt: LATER,
      }),
    ).toThrow();
  });
});

const account = buildAccountResource({
  id: IDS.account,
  referenceId: 'user-test-001',
  status: 'active',
  fields: {},
  tags: [],
  consolidatedInto: null,
  accountTypeId: IDS.accountType,
  inquiryIds: [IDS.inquiry],
  createdAt: AT,
  updatedAt: LATER,
  redactedAt: null,
});

const session = buildInquirySessionResource({
  id: IDS.inquirySession,
  inquiryId: IDS.inquiry,
  status: 'expired',
  createdAt: AT,
  startedAt: LATER,
  expiresAt: LATEST,
  ipAddress: null,
  userAgent: null,
});

function event(name: string, payload: unknown, extra: Record<string, unknown> = {}) {
  return {
    type: 'event',
    id: IDS.approvedEvent,
    attributes: { name, payload, 'created-at': LATER_ISO, ...extra },
  };
}

describe('Phase 2 events (C14, C16, C17)', () => {
  it('mark simulated events', () => {
    const value = event('inquiry.completed', { data: inquiry }, { simulated: true });
    expect(eventResourceSchema.parse(value)).toEqual(value);
    expect(
      buildEventResource({
        id: IDS.approvedEvent,
        name: 'inquiry.completed',
        payload: { data: inquiry },
        createdAt: LATER,
        simulated: false,
      }).attributes.simulated,
    ).toBe(false);
  });

  it('carry an account for account events, with related accounts included', () => {
    const value = event('account.consolidated', { data: account, included: [account] });
    expect(eventResourceSchema.parse(value)).toEqual(value);
    expect(eventResourceSchema.safeParse(event('account.created', { data: inquiry })).success).toBe(
      false,
    );
  });

  it('carry an inquiry session for inquiry-session events', () => {
    expect(
      eventResourceSchema.safeParse(event('inquiry-session.expired', { data: session })).success,
    ).toBe(true);
    expect(
      eventResourceSchema.safeParse(event('inquiry-session.expired', { data: inquiry })).success,
    ).toBe(false);
    expect(eventResourceSchema.safeParse(event('inquiry.started', { data: session })).success).toBe(
      false,
    );
  });

  it('carry the from and to statuses on inquiry.transitioned', () => {
    const value = event('inquiry.transitioned', {
      data: inquiry,
      meta: { from: 'needs_review', to: 'approved' },
    });
    expect(eventResourceSchema.parse(value)).toEqual(value);
    expect(
      eventResourceSchema.safeParse(event('inquiry.transitioned', { data: inquiry })).success,
    ).toBe(false);
    expect(
      eventResourceSchema.safeParse(
        event('inquiry.transitioned', { data: inquiry, meta: { from: 'x', to: 'approved' } }),
      ).success,
    ).toBe(false);
  });

  it('accept the stub that replaces a redacted payload (C16)', () => {
    const stub = { type: 'inquiry', id: IDS.inquiry, attributes: { 'redacted-at': AT_ISO } };
    expect(redactedResourceStubSchema.parse(stub)).toEqual(stub);
    expect(eventResourceSchema.parse(event('inquiry.approved', { data: stub }))).toEqual(
      event('inquiry.approved', { data: stub }),
    );
    expect(
      eventResourceSchema.safeParse(
        event('account.redacted', {
          data: { type: 'account', id: IDS.account, attributes: { 'redacted-at': AT_ISO } },
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    [
      'a stub whose id has another prefix',
      { type: 'inquiry', id: IDS.account, attributes: { 'redacted-at': AT_ISO } },
    ],
    [
      'a stub of an unknown type',
      { type: 'file', id: IDS.front, attributes: { 'redacted-at': AT_ISO } },
    ],
    [
      'a stub that keeps an attribute',
      { type: 'inquiry', id: IDS.inquiry, attributes: { 'redacted-at': AT_ISO, note: 'x' } },
    ],
  ])('rejects %s', (_name, stub) => {
    expect(storedEventPayloadSchema.safeParse({ data: stub }).success).toBe(false);
  });

  it('keeps the payload an event is created with free of stubs', () => {
    const stub = { type: 'inquiry', id: IDS.inquiry, attributes: { 'redacted-at': AT_ISO } };
    expect(eventPayloadSchema.safeParse({ data: stub }).success).toBe(false);
    expect(redactedEventPayloadSchema.parse({ data: stub })).toEqual({ data: stub });
    expect(redactedEventPayloadSchema.safeParse({ data: stub, included: [] }).success).toBe(false);
    expect(storedEventPayloadSchema.parse({ data: inquiry })).toEqual({ data: inquiry });
  });

  it('accepts a redacted inquiry.transitioned event, whose meta is gone', () => {
    const stub = { type: 'inquiry', id: IDS.inquiry, attributes: { 'redacted-at': AT_ISO } };
    expect(
      eventResourceSchema.safeParse(event('inquiry.transitioned', { data: stub })).success,
    ).toBe(true);
  });

  it('rejects a stub that does not match the event subject', () => {
    const stub = { type: 'account', id: IDS.account, attributes: { 'redacted-at': AT_ISO } };
    expect(eventResourceSchema.safeParse(event('inquiry.redacted', { data: stub })).success).toBe(
      false,
    );
  });

  it('accept verification stubs for verification events', () => {
    const stub = {
      type: 'verification/selfie',
      id: IDS.selfie,
      attributes: { 'redacted-at': AT_ISO },
    };
    expect(
      eventResourceSchema.safeParse(event('verification.passed', { data: stub })).success,
    ).toBe(true);
  });
});

describe('GET /api/v1/events (C12)', () => {
  it('filters by name list, object, time range and simulation', () => {
    const query = {
      'filter[name]': 'inquiry.approved,account.created',
      'filter[object-id]': IDS.account,
      'filter[created-at-start]': '2026-10-01T00:00:00Z',
      'filter[created-at-end]': '2026-10-02T00:00:00Z',
      'filter[simulated]': 'true',
      'page[after]': IDS.event,
    };
    expect(listEventsQuerySchema.parse(query)).toEqual(query);
    expect(listEventsQuerySchema.safeParse({ 'filter[name]': 'inquiry.deleted' }).success).toBe(
      false,
    );
    expect(listEventsQuerySchema.safeParse({ 'filter[simulated]': 'yes' }).success).toBe(false);
    expect(listEventsQuerySchema.safeParse({ 'filter[object-id]': 'nope' }).success).toBe(false);
  });

  it('lists events', () => {
    const value = event('inquiry.completed', { data: inquiry });
    expect(eventListDocumentSchema.parse({ data: [value], links: { next: null } })).toEqual({
      data: [value],
      links: { next: null },
    });
  });
});

describe('GET /api/v1/events by inquiry (C25.7, Workflow 2E)', () => {
  it('filters by the inquiry the events are about, with the other filters', () => {
    const query = {
      'filter[inquiry-id]': `${IDS.inquiry},${IDS.otherInquiry}`,
      'filter[name]': 'verification.passed,inquiry-session.started',
      'page[after]': IDS.event,
    };
    expect(listEventsQuerySchema.parse(query)).toEqual(query);
  });

  it.each([
    ['a verification id', IDS.governmentId],
    ['a malformed id', 'inq_nope'],
    ['an empty value', ''],
  ])('rejects %s', (_name, value) => {
    expect(listEventsQuerySchema.safeParse({ 'filter[inquiry-id]': value }).success).toBe(false);
  });
});

describe('the Workflow 8B events (C129.6)', () => {
  const golden = (file: string) => eventDocumentSchema.parse(readFixture(`api/${file}`)).data;
  const payloadOf = (file: string) =>
    structuredClone(golden(file).attributes.payload) as {
      data: { attributes: Record<string, unknown> };
      meta?: unknown;
    };

  it('registers the eleven public webhooks, the two of the events page, and the two subjects', () => {
    expect(CASE_EVENT_NAMES).toEqual([
      'case.created',
      'case.assigned',
      'case.resolved',
      'case.reopened',
      'case.status-updated',
      'case.queue-updated',
      'case.updated-fields',
      'case.updated-tags',
      'case.sla-expired',
      'case.exported',
      'case.redacted',
      'case.updated',
      'case.print-initiated',
    ]);
    expect(CASE_COMMENT_EVENT_NAMES).toEqual(['case-comment.created']);
    expect(CASE_TEMPLATE_EVENT_NAMES).toEqual(['case-template.deleted-field']);
  });

  it.each([
    ['case.resolved', 'case'],
    ['case.sla-expired', 'case'],
    ['case-comment.created', 'case-comment'],
    ['case-template.deleted-field', 'case-template'],
  ])('%s has the subject %s', (name, subject) => {
    expect(eventSubject(name as EventName)).toBe(subject);
    expect(eventResourceType(name as EventName)).toBe(subject);
  });

  it.each(
    [...CASE_EVENT_NAMES, ...CASE_COMMENT_EVENT_NAMES, ...CASE_TEMPLATE_EVENT_NAMES].map((name) => [
      name,
      `event-${name.replace('.', '-')}.json`,
    ]),
  )('%s has a golden payload', (name, file) => {
    expect(golden(file).attributes.name).toBe(name);
  });

  it.each([
    ['case.created', 'event-case-created.json'],
    ['case.resolved', 'event-case-resolved.json'],
  ])('%s carries no field value (C136.4)', (name, file) => {
    const payload = payloadOf(file);
    expect(payload.data.attributes.fields).toBeNull();
    payload.data.attributes.fields = { summary: { type: 'string', value: 'Synthetic' } };
    expect(eventResourceSchema.safeParse(event(name, payload)).success).toBe(false);
  });

  it("carries no attachment's filename, and its id, size and scan status stay (C135, C143.5)", () => {
    const payload = payloadOf('event-case-created.json');
    const attachment = {
      id: 'catt_01M5CN00000000000000000019',
      filename: null,
      url: '/api/v1/cases/case_01M5CN00000000000000000001/attachments/catt_01M5CN00000000000000000019/content',
      'byte-size': 48213,
      'attachment-type': 'pdf',
      'scan-status': 'not_scanned',
      'scan-provider': null,
      'scanned-at': null,
      'rendition-status': 'pending',
      'page-count': null,
      'created-at': '2026-10-20T12:00:00.000Z',
    };
    payload.data.attributes.attachments = [attachment];
    expect(eventResourceSchema.safeParse(event('case.created', payload)).success).toBe(true);
    payload.data.attributes.attachments = [{ ...attachment, filename: 'synthetic-statement.pdf' }];
    expect(eventResourceSchema.safeParse(event('case.created', payload)).success).toBe(false);
  });

  it("carries no comment's words (C134.1, C107.5)", () => {
    const payload = payloadOf('event-case-comment-created.json');
    expect(payload.data.attributes.message).toBeNull();
    payload.data.attributes.message = 'Synthetic words';
    expect(eventResourceSchema.safeParse(event('case-comment.created', payload)).success).toBe(
      false,
    );
  });

  it.each([
    ['case.updated-tags', 'event-case-updated-tags.json'],
    ['case.updated-fields', 'event-case-updated-fields.json'],
    ['case.status-updated', 'event-case-status-updated.json'],
    ['case.exported', 'event-case-exported.json'],
    ['case-template.deleted-field', 'event-case-template-deleted-field.json'],
  ])('%s carries its meta, and is refused without it', (name, file) => {
    const { meta, ...payload } = payloadOf(file);
    expect(meta).toBeDefined();
    expect(eventResourceSchema.safeParse(event(name, payload)).success).toBe(false);
  });

  it('names the tags that changed in the public context (C136.5)', () => {
    expect(payloadOf('event-case-updated-tags.json').meta).toEqual({
      context: { 'added-tags': ['escalated'], 'removed-tags': [] },
    });
  });

  it('names the keys that changed, never a value (C136.4)', () => {
    const payload = payloadOf('event-case-updated-fields.json');
    expect(payload.meta).toEqual({ context: { 'field-keys': ['summary', 'risk-reasons'] } });
    const leaked = { ...payload, meta: { context: { summary: 'Synthetic' } } };
    expect(eventResourceSchema.safeParse(event('case.updated-fields', leaked)).success).toBe(false);
  });

  it('refuses a case event with another subject', () => {
    const { data } = payloadOf('event-case-comment-created.json');
    expect(eventResourceSchema.safeParse(event('case.created', { data })).success).toBe(false);
  });

  it.each([
    ['case', 'case_01M5CN00000000000000000001', 'case.redacted'],
    ['case-comment', 'cscm_01M5CN00000000000000000008', 'case-comment.created'],
  ])('stubs a redacted %s, by its own prefix (C139.1)', (type, id, name) => {
    const stub = { type, id, attributes: { 'redacted-at': AT_ISO } };
    expect(redactedResourceStubSchema.parse(stub)).toEqual(stub);
    expect(
      redactedResourceStubSchema.safeParse({ ...stub, id: 'inq_01M5CJXHG07XPHF3HRM6NREDH7' })
        .success,
    ).toBe(false);
    expect(eventResourceSchema.safeParse(event(name, { data: stub })).success).toBe(true);
  });
});

describe('the Workflow 8A events (C112.7, C127.12, C128.6)', () => {
  const golden = (file: string) => eventDocumentSchema.parse(readFixture(`api/${file}`)).data;

  it('registers the workflow, version, run and list events', () => {
    expect(WORKFLOW_EVENT_NAMES).toEqual(['workflow.published', 'workflow.paused']);
    expect(WORKFLOW_VERSION_EVENT_NAMES).toEqual(['workflow-version.published']);
    expect(WORKFLOW_RUN_EVENT_NAMES).toEqual([
      'workflow-run.created',
      'workflow-run.resumed',
      'workflow-run.errored',
      'workflow-run.completed',
      'workflow-run.canceled',
    ]);
    expect(LIST_EVENT_NAMES).toEqual(['list.updated']);
    expect(INQUIRY_EVENT_NAMES).toContain('inquiry.reopened');
    for (const name of [
      ...WORKFLOW_EVENT_NAMES,
      ...WORKFLOW_VERSION_EVENT_NAMES,
      ...WORKFLOW_RUN_EVENT_NAMES,
      ...LIST_EVENT_NAMES,
      'inquiry.reopened',
    ]) {
      expect(isEventName(name), name).toBe(true);
    }
  });

  it.each([
    ['workflow.published', 'workflow'],
    ['workflow.paused', 'workflow'],
    ['workflow-version.published', 'workflow-version'],
    ['workflow-run.errored', 'workflow-run'],
    ['list.updated', 'list'],
    ['inquiry.reopened', 'inquiry'],
  ])('%s has the subject %s', (name, subject) => {
    expect(eventSubject(name as EventName)).toBe(subject);
  });

  it('carries a list of any kind on list.updated, with its change', () => {
    const { attributes } = golden('event-list-updated.json');
    expect(attributes.payload.data.type).toMatch(/^list\//);
    expect(listUpdatedMetaSchema.parse((attributes.payload as { meta: unknown }).meta)).toEqual({
      'change-kind': 'items-added',
      counts: { 'items-changed': 3 },
      'list-version': 8,
    });
  });

  it('refuses list.updated with another subject, or with no change', () => {
    const { attributes } = golden('event-list-updated.json');
    const payload = attributes.payload as { data: unknown };
    expect(
      eventResourceSchema.safeParse(event('list.updated', { data: payload.data })).success,
    ).toBe(false);
    expect(eventResourceSchema.safeParse(event('list.updated', { data: inquiry })).success).toBe(
      false,
    );
  });

  it('refuses an unknown change kind, and archives a list as archived (outcome 25)', () => {
    const meta = { counts: { 'items-changed': 0 }, 'list-version': 2 };
    expect(listUpdatedMetaSchema.safeParse({ ...meta, 'change-kind': 'archived' }).success).toBe(
      true,
    );
    expect(listUpdatedMetaSchema.safeParse({ ...meta, 'change-kind': 'renamed' }).success).toBe(
      false,
    );
    expect(LIST_UPDATE_CHANGE_KINDS).toEqual([
      'items-added',
      'items-archived',
      'items-rewritten',
      'items-redacted',
      'archived',
    ]);
  });

  it('carries a reopened inquiry as needing review', () => {
    expect(golden('event-inquiry-reopened.json').attributes.payload.data.attributes).toMatchObject({
      status: 'needs_review',
    });
  });

  const runPayload = () =>
    structuredClone(golden('event-workflow-run-completed.json').attributes.payload) as {
      data: { attributes: Record<string, unknown> };
      meta: unknown;
    };

  it('carries no run value in an event (C112.7, C125.5)', () => {
    for (const member of ['inputs', 'variables', 'outputs', 'trigger-snapshot']) {
      const payload = runPayload();
      payload.data.attributes[member] = { decision: 'decline' };
      expect(
        eventResourceSchema.safeParse(event('workflow-run.completed', payload)).success,
        member,
      ).toBe(false);
    }
  });

  it('carries output names on a completed run, never values (C119.10)', () => {
    const payload = runPayload();
    expect(payload.meta).toEqual({ context: { 'output-names': ['decision'] } });
  });

  it('carries the step and error on an errored run, and refuses one without them', () => {
    const { payload } = golden('event-workflow-run-errored.json').attributes;
    expect((payload as { meta: unknown }).meta).toEqual({
      context: {
        'errored-step': {
          name: 'Run the watchlist report',
          key: 'run_watchlist',
          type: 'action',
          'action-key': 'run_report',
        },
        error: { type: 'resource-error', message: 'A resource the run needed failed.' },
      },
    });
    expect(
      eventResourceSchema.safeParse(
        event('workflow-run.errored', { ...payload, meta: { context: {} } }),
      ).success,
    ).toBe(false);
  });

  it('carries no definition in a version event', () => {
    const { payload } = golden('event-workflow-version-published.json').attributes;
    const { attributes } = payload.data as unknown as { attributes: { definition: unknown } };
    expect(attributes.definition).toBeNull();
    const { data } = readFixture('api/workflow-version.json') as { data: unknown };
    expect(
      eventResourceSchema.safeParse(event('workflow-version.published', { data })).success,
    ).toBe(false);
  });

  it('stubs a redacted run, by its own prefix (C120.9)', () => {
    const stub = {
      type: 'workflow-run',
      id: 'wfr_01M5CM00000000000000000006',
      attributes: { 'redacted-at': AT_ISO },
    };
    expect(redactedResourceStubSchema.parse(stub)).toEqual(stub);
    expect(
      redactedResourceStubSchema.safeParse({ ...stub, id: 'inq_01M5CJXHG07XPHF3HRM6NREDH7' })
        .success,
    ).toBe(false);
    expect(
      eventResourceSchema.safeParse(event('workflow-run.completed', { data: stub })).success,
    ).toBe(true);
  });
});
