import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  buildDecisionResource,
  contestRouteSchema,
  decisionListDocumentSchema,
  decisionMetaSchema,
  decisionResourceSchema,
  flowDecisionContestRouteSchema,
  inquiryDeclinedMetaSchema,
  listDecisionsQuerySchema,
  PII_DECISION_ATTRIBUTES,
  type DecisionRecord,
} from './decisions.js';
import { eventResourceSchema } from './events.js';
import { readFixture, AT, IDS } from './test-support.js';

const DECISION = 'idec_01M5CM00000000000000000020';
const RUN = 'wfr_01M5CM00000000000000000006';
const SHA = '0'.repeat(63) + 'a';

const RECORD: DecisionRecord = {
  id: DECISION,
  kind: 'decline',
  subject: { type: 'inquiry', id: IDS.inquiry },
  actor: { type: 'workflow-run', id: RUN },
  run: {
    workflowId: 'wfl_01M5CM00000000000000000001',
    workflowVersionId: 'wfv_01M5CM00000000000000000002',
    nodeId: 'decline_it',
    routes: [{ nodeId: 'check_report', routeKey: 'matched' }],
    conditionSha256: [SHA],
    codeSha256: [],
  },
  solelyAutomated: true,
  humanStep: null,
  evidence: [
    {
      kind: 'report-match',
      id: 'rpm_01M5CM00000000000000000021',
      name: null,
      status: 'matched',
      tier: 'H',
      stage: 'beta',
      confidence: 0.82,
    },
  ],
  pendingEvidence: [{ kind: 'list-screening', id: null, name: null }],
  decisionBasis: 'contract',
  contestRoute: { url: 'https://example.com/contest' },
  biometricBasis: null,
  comment: null,
  needsReview: false,
  humanReviewPending: false,
  errorCode: null,
  testRunId: null,
  createdAt: AT,
};

const attributesOf = (record: DecisionRecord) =>
  (buildDecisionResource(record) as { attributes: Record<string, unknown> }).attributes;

describe('the decision record (C128.1)', () => {
  it('builds a run decision with its path, evidence and basis, and validates it', () => {
    const resource = buildDecisionResource(RECORD) as { type: string; id: string };
    expect(resource.type).toBe('decision');
    expect(resource.id).toBe(DECISION);
    expect(decisionResourceSchema.parse(resource)).toEqual(resource);
    expect(attributesOf(RECORD)).toMatchObject({
      kind: 'decline',
      actor: { type: 'workflow-run', id: RUN },
      'solely-automated': true,
      'decision-basis': 'contract',
      'contest-route': { url: 'https://example.com/contest' },
      run: {
        'workflow-id': RECORD.run?.workflowId,
        'node-id': 'decline_it',
        routes: [{ 'node-id': 'check_report', 'route-key': 'matched' }],
        'condition-sha256': [SHA],
        'code-sha256': [],
      },
    });
  });

  it.each([
    ['inquiry', { type: 'inquiry', id: IDS.inquiry }],
    ['transaction', { type: 'transaction', id: 'txn_01M5CK3190XEVBM5ZXA76E1JSN' }],
    ['account', { type: 'account', id: 'acc_01M5CK3190XEVBM5ZXA76E1JSN' }],
    ['list item', { type: 'list-item/name', id: 'lin_01M5CK3190XEVBM5ZXA76E1JSN' }],
  ])('names a polymorphic subject: %s', (_name, subject) => {
    const resource = buildDecisionResource({ ...RECORD, kind: 'adverse', subject }) as {
      relationships: { subject: { data: unknown } };
    };
    expect(resource.relationships.subject.data).toEqual(subject);
  });

  it('refuses a subject that is none of the four, and a list item id of another kind', () => {
    expect(() =>
      buildDecisionResource({ ...RECORD, subject: { type: 'report/watchlist', id: IDS.inquiry } }),
    ).toThrow();
    expect(() =>
      buildDecisionResource({
        ...RECORD,
        subject: { type: 'list-item/name', id: 'liea_01M5CK3190XEVBM5ZXA76E1JSN' },
      }),
    ).toThrow();
  });

  it('records a user or API decision with no run, and the declared flag', () => {
    const attributes = attributesOf({
      ...RECORD,
      actor: { type: 'api-key', id: 'key_01M5CJZC30W7PFE0GD30HJWEC6' },
      run: null,
      solelyAutomated: null,
      decisionBasis: null,
      contestRoute: null,
    });
    expect(attributes.run).toBeNull();
    expect(attributes['solely-automated']).toBeNull();
  });

  it('refuses the system as an actor: a decision has someone behind it', () => {
    expect(() =>
      buildDecisionResource({ ...RECORD, actor: { type: 'system', id: null } as never }),
    ).toThrow();
  });

  it('names the person who took part and how, never the case text (C128.2)', () => {
    const attributes = attributesOf({
      ...RECORD,
      solelyAutomated: false,
      humanStep: {
        kind: 'case-resolution',
        actorId: 'usr_01M5CJZC30W7PFE0GD30HJWEC6',
        eventId: 'evt_01M5CJZC30W7PFE0GD30HJWEC6',
        resolvedVia: 'single',
        nodeId: 'wait_for_case',
      },
    });
    expect(attributes['human-step']).toEqual({
      kind: 'case-resolution',
      'actor-id': 'usr_01M5CJZC30W7PFE0GD30HJWEC6',
      'event-id': 'evt_01M5CJZC30W7PFE0GD30HJWEC6',
      'resolved-via': 'single',
      'node-id': 'wait_for_case',
    });
  });

  it('refuses a person on a record that says solely automated', () => {
    expect(() =>
      buildDecisionResource({
        ...RECORD,
        solelyAutomated: true,
        humanStep: {
          kind: 'case-resolution',
          actorId: 'usr_01M5CJZC30W7PFE0GD30HJWEC6',
          eventId: 'evt_01M5CJZC30W7PFE0GD30HJWEC6',
          resolvedVia: 'single',
          nodeId: 'wait_for_case',
        },
      }),
    ).toThrow();
  });

  it('keeps evidence as codes and ids: a free-text member or a long name is refused', () => {
    const evidence = { ...RECORD.evidence[0], extra: 'Jane Doe' };
    expect(() => buildDecisionResource({ ...RECORD, evidence: [evidence] as never })).toThrow();
    const named = { ...RECORD.evidence[0], name: 'Jane Doe' };
    expect(() => buildDecisionResource({ ...RECORD, evidence: [named] as never })).toThrow();
  });

  it('carries the tier, stage and confidence of an H-tier input (H10)', () => {
    const [first] = RECORD.evidence;
    expect(first?.tier).toBe('H');
    expect(() =>
      buildDecisionResource({
        ...RECORD,
        evidence: [{ ...first, tier: null, stage: null }] as never,
      }),
    ).toThrow();
  });

  it('marks a sealed comment PII and masks it to null (C128.1, P19)', () => {
    expect(PII_DECISION_ATTRIBUTES).toEqual(['comment']);
    const held = attributesOf({ ...RECORD, comment: 'A synthetic note' });
    expect(held.comment).toBe('A synthetic note');
    expect(attributesOf({ ...RECORD, comment: null }).comment).toBeNull();
    const { shape } = (decisionResourceSchema as unknown as { shape: { attributes: z.ZodObject } })
      .shape.attributes;
    expect((shape.comment as z.ZodType).meta()).toEqual({ pii: true });
  });

  it('records the error of a gate on a subject that cannot be marked for review (C128.3)', () => {
    const attributes = attributesOf({
      ...RECORD,
      kind: 'adverse',
      subject: { type: 'transaction', id: 'txn_01M5CK3190XEVBM5ZXA76E1JSN' },
      needsReview: true,
      errorCode: 'decision_basis_missing',
    });
    expect(attributes).toMatchObject({
      'needs-review': true,
      'error-code': 'decision_basis_missing',
    });
  });

  it('holds human review pending on a reopen (C128.6)', () => {
    const attributes = attributesOf({
      ...RECORD,
      kind: 'reopen',
      actor: { type: 'user', id: 'usr_01M5CJZC30W7PFE0GD30HJWEC6' },
      run: null,
      humanReviewPending: true,
    });
    expect(attributes['human-review-pending']).toBe(true);
  });

  it('stamps a test run (C120.7)', () => {
    expect(attributesOf({ ...RECORD, testRunId: RUN })['test-run-id']).toBe(RUN);
  });

  it('parses the golden list', () => {
    const document = decisionListDocumentSchema.parse(readFixture('api/decisions.json')) as {
      data: { attributes: { kind: string } }[];
    };
    expect(document.data.map(({ attributes }) => attributes.kind)).toEqual(['decline', 'reopen']);
  });
});

describe('GET /decisions (C128.1, V10)', () => {
  it('filters by subject, of any of the four id prefixes', () => {
    for (const id of [
      IDS.inquiry,
      'txn_01M5CK3190XEVBM5ZXA76E1JSN',
      'acc_01M5CK3190XEVBM5ZXA76E1JSN',
      'lin_01M5CK3190XEVBM5ZXA76E1JSN',
    ]) {
      expect(listDecisionsQuerySchema.parse({ 'filter[subject-id]': id })).toMatchObject({
        'filter[subject-id]': id,
      });
    }
  });

  it('refuses an id of a subject that has no decisions', () => {
    expect(
      listDecisionsQuerySchema.safeParse({ 'filter[subject-id]': 'rep_01M5CK3190XEVBM5ZXA76E1JSN' })
        .success,
    ).toBe(false);
  });
});

describe('the contest route (C128.3)', () => {
  const parse = (value: unknown) => contestRouteSchema.safeParse(value).success;

  it('reaches the person by a URL or a contact, optionally with a case template', () => {
    expect(parse({ url: 'https://example.com/contest' })).toBe(true);
    expect(parse({ contact: 'review@example.com' })).toBe(true);
    expect(
      parse({
        contact: 'review@example.com',
        'case-template-id': 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN',
      }),
    ).toBe(true);
  });

  it('refuses a case template alone: it does not reach the person', () => {
    expect(parse({ 'case-template-id': 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN' })).toBe(false);
    expect(parse({})).toBe(false);
  });

  it('takes https only', () => {
    expect(parse({ url: 'http://example.com/contest' })).toBe(false);
    expect(parse({ url: 'javascript:alert(1)' })).toBe(false);
  });

  it('refuses an unknown member and a control character in a contact', () => {
    expect(parse({ contact: 'a@example.com', extra: true })).toBe(false);
    expect(parse({ contact: 'a@example.com\r\nBcc: b@example.com' })).toBe(false);
  });
});

describe('inquiry.declined carries the decision (C128.1, P40)', () => {
  const META = {
    decision: {
      id: DECISION,
      'solely-automated': true,
      'decision-basis': 'contract',
      'contest-route': { url: 'https://example.com/contest' },
    },
  };

  it('holds the four members and nothing else', () => {
    expect(inquiryDeclinedMetaSchema.parse(META)).toEqual(META);
    expect(decisionMetaSchema.safeParse({ ...META.decision, evidence: [] }).success).toBe(false);
  });

  it('takes nulls: an API decline declares nothing', () => {
    const decision = {
      id: DECISION,
      'solely-automated': null,
      'decision-basis': null,
      'contest-route': null,
    };
    expect(decisionMetaSchema.parse(decision)).toEqual(decision);
  });

  it('is what the golden declined event carries, and a simulated one has none', () => {
    const event = readFixture('api/event-inquiry-declined.json') as {
      data: { attributes: { payload: { meta?: unknown } } };
    };
    const { success } = eventResourceSchema.safeParse(event.data);
    expect(success).toBe(true);
    expect(inquiryDeclinedMetaSchema.safeParse(event.data.attributes.payload.meta).success).toBe(
      true,
    );
    const payload = { ...event.data.attributes.payload };
    delete payload.meta;
    expect(
      eventResourceSchema.safeParse({
        ...event.data,
        attributes: { ...event.data.attributes, payload, simulated: true },
      }).success,
    ).toBe(true);
  });

  it('refuses a malformed decision on a declined event', () => {
    const event = readFixture('api/event-inquiry-declined.json') as {
      data: { attributes: { payload: object } };
    };
    expect(
      eventResourceSchema.safeParse({
        ...event.data,
        attributes: {
          ...event.data.attributes,
          payload: { ...event.data.attributes.payload, meta: { decision: { id: 'nope' } } },
        },
      }).success,
    ).toBe(false);
  });
});

describe('the flow session route (C128.7)', () => {
  it('shows a URL with its host, or a contact', () => {
    const route = { url: 'https://example.com/contest', host: 'example.com', contact: null };
    expect(flowDecisionContestRouteSchema.parse(route)).toEqual(route);
    const contact = { url: null, host: null, contact: 'review@example.com' };
    expect(flowDecisionContestRouteSchema.parse(contact)).toEqual(contact);
  });

  it('refuses a host that is not the URL host, and a route with nothing to show', () => {
    const parse = (value: unknown) => flowDecisionContestRouteSchema.safeParse(value).success;
    expect(parse({ url: 'https://example.com/a', host: 'example.org', contact: null })).toBe(false);
    expect(parse({ url: null, host: null, contact: null })).toBe(false);
  });
});
