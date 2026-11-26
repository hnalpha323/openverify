/**
 * Phase 11, Workflow 11A Stage 1a, the common checkpoint (C230.1, C231-C240): the ids, Connect's
 * problem codes with one golden problem each, the two rate policies, the event names with their
 * subjects and samples, `provenance` on an inquiry's payload, and the two environment settings.
 * Everything is read through the package root, so the export lines are held too.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';
import { listFixtures, readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  if (!(found instanceof z.ZodType)) {
    throw new TypeError(`${name} is not exported as a schema`);
  }
  return found;
};

const TITLES: Readonly<Record<number, string>> = {
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

describe('the Connect ids (C230.1)', () => {
  it('holds the two public prefixes and our two', () => {
    expect(contracts.ID_PREFIXES).toMatchObject({
      connection: 'cxn',
      shareToken: 'cnst',
      sharePolicy: 'cxnp',
      consentRecord: 'cnsr',
    });
  });

  it.each(['cxn', 'cnst', 'cxnp', 'cnsr'])(
    'recognises a %s id and no other prefix as one',
    (prefix) => {
      const id = `${prefix}_01M5CN0000000000000011A100`;
      expect(contracts.isId(prefix as contracts.IdPrefix, id)).toBe(true);
      expect(contracts.isId('inq', id)).toBe(false);
      expect(contracts.anyIdSchema.safeParse(id).success).toBe(true);
    },
  );
});

const CONNECT_PROBLEMS: Readonly<Record<string, number>> = {
  destination_not_found: 422,
  connection_exists: 409,
  connection_not_active: 409,
  share_policy_changed: 409,
  share_policy_invalid: 422,
  environment_kind_mismatch: 422,
  source_redacted: 409,
  source_not_decided: 409,
  source_is_copy: 409,
  share_source_not_allowed: 422,
  share_source_not_supported: 422,
  consent_required: 422,
  share_token_outlives_consent: 422,
  share_token_not_expirable: 409,
  share_token_not_redeemable: 409,
  connect_peek_unavailable: 503,
  share_token_peek_limit: 429,
  share_token_already_redeemed: 409,
  share_token_expired: 409,
  share_redeem_mode_invalid: 422,
  share_redeem_meta_conflict: 422,
  destination_inquiry_not_open: 409,
  consent_declined_in_flow: 409,
  consent_already_withdrawn: 409,
  explicit_consent_required: 422,
  share_consent_step_missing: 422,
  share_token_in_use: 409,
};

const fileOf = (code: string) => `${code.replaceAll('_', '-')}.json`;

describe('problems/connect/ (C231-C238)', () => {
  it('freezes the problem codes with their statuses', () => {
    const frozen = pick('CONNECT_PROBLEM_STATUSES');
    expect(frozen).toEqual(CONNECT_PROBLEMS);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(pick('CONNECT_PROBLEM_CODES')).toEqual(Object.keys(CONNECT_PROBLEMS));
  });

  it('holds one golden problem per code, named by it, and the one 404', () => {
    expect(listFixtures('problems/connect')).toEqual(
      [...Object.keys(CONNECT_PROBLEMS).map(fileOf), 'not-found.json'].sort(),
    );
  });

  it.each(Object.entries(CONNECT_PROBLEMS))('carries code %s with status %d', (code, status) => {
    const raw = readFixture(`problems/connect/${fileOf(code)}`);
    const problem = contracts.problemSchema.parse(raw);
    expect(problem).toEqual(raw);
    expect(problem).toMatchObject({ type: 'about:blank', title: TITLES[status], status, code });
    expect(z.encode(contracts.problemSchema, problem)).toEqual(raw);
    // Rule 11: no id of another organisation, no value, no address.
    expect(problem.detail).not.toMatch(/[0-9]{4}|@|org_/);
  });

  it('gives consent_required its reason, one of the closed list (C232.1, C234.1)', () => {
    expect(pick('CONSENT_REQUIRED_REASONS')).toEqual([
      'missing',
      'subject',
      'recipient',
      'categories',
      'explicit_biometric',
      'attested_not_accepted',
      'withdrawn',
      'expired',
      'already_used',
    ]);
    const raw = readFixture('problems/connect/consent-required.json');
    const parsed = schema('consentRequiredProblemSchema').parse(raw);
    expect(parsed).toMatchObject({ code: 'consent_required', reason: 'categories' });
    const withoutReason = Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(([member]) => member !== 'reason'),
    );
    expect(schema('consentRequiredProblemSchema').safeParse(withoutReason).success).toBe(false);
    expect(
      schema('consentRequiredProblemSchema').safeParse({
        ...withoutReason,
        reason: 'inquiry_expired',
      }).success,
    ).toBe(false);
  });

  it('keeps Phase 7 consent_required (409, flow signals) apart from Connect (422)', () => {
    expect(contracts.SIGNAL_PROBLEM_STATUSES.consent_required).toBe(409);
    expect(CONNECT_PROBLEMS.consent_required).toBe(422);
  });

  it('reuses Phase 9 codes with their statuses instead of declaring them again', () => {
    const connect = (pick('CONNECT_PROBLEM_STATUSES') ?? {}) as Readonly<Record<string, number>>;
    expect(contracts.FLOW_ENGINE_PROBLEM_STATUSES).toMatchObject({
      consent_text_mismatch: 422,
      flow_step_not_current: 409,
    });
    expect(contracts.ACCESS_PROBLEM_STATUSES.step_up_required).toBe(403);
    for (const reused of ['consent_text_mismatch', 'flow_step_not_current', 'step_up_required']) {
      expect(Object.hasOwn(connect, reused)).toBe(false);
    }
  });

  it('points share_policy_invalid at the policy members that break a rule', () => {
    const raw = readFixture('problems/connect/share-policy-invalid.json') as {
      errors: { location: string; pointer: string }[];
    };
    expect(raw.errors.map(({ pointer }) => pointer)).toEqual([
      '/data/attributes/share-policy/verifications/types/1',
      '/data/attributes/share-policy/peek/account.fields.name_first',
    ]);
  });

  it('holds the one 404: no code, no id, the frozen title and detail (C232.8)', () => {
    const raw = readFixture('problems/connect/not-found.json') as Record<string, unknown>;
    expect(contracts.problemSchema.parse(raw)).toEqual(raw);
    expect(pick('CONNECT_NOT_FOUND_PROBLEM')).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'The requested resource was not found.',
    });
    expect(raw).toMatchObject(pick('CONNECT_NOT_FOUND_PROBLEM') as Record<string, unknown>);
    expect(Object.keys(raw).sort()).toEqual(
      ['detail', 'instance', 'requestId', 'status', 'title', 'type'].sort(),
    );
  });
});

describe('the Connect rate policies (C240.3)', () => {
  it.each([
    ['connect-redeem', 60, 60],
    ['connect-peek', 60, 60],
  ] as const)('holds %s in all three maps: %d per %d s', (policy, limit, window) => {
    expect(contracts.RATE_LIMIT_POLICIES as readonly string[]).toContain(policy);
    expect((contracts.RATE_LIMIT_DEFAULTS as Readonly<Record<string, number>>)[policy]).toBe(limit);
    expect((contracts.RATE_LIMIT_POLICY_WINDOWS as Readonly<Record<string, number>>)[policy]).toBe(
      window,
    );
  });
});

const CONNECTION_EVENTS = [
  'connect/connection.created',
  'connect/connection.activated',
  'connect/connection.deactivated',
  'connect/connection.reactivated',
  'connect/connection.share-policy-changed',
];
const SHARE_TOKEN_EVENTS = [
  'connect/share-token.outbound-created',
  'connect/share-token.inbound-created',
  'connect/share-token.outbound-redeemed',
  'connect/share-token.inbound-redeemed',
  'connect/share-token.expired',
  'connect/share-token.failed',
  'connect/share-token.consent-withdrawn',
  'connect/share-token.source-redacted',
];
const CONSENT_RECORD_EVENTS = [
  'consent-record.created',
  'consent-record.declined',
  'consent-record.withdrawn',
];
const CONNECT_EVENTS = [...CONNECTION_EVENTS, ...SHARE_TOKEN_EVENTS, ...CONSENT_RECORD_EVENTS];

const sampleFile = (name: string) =>
  `api/connect/event-${name.replace('connect/', '').replace('.', '-')}.json`;

describe('the Connect events (C239)', () => {
  it('names the four public share-token events, then ours, and never .ready', () => {
    expect(pick('CONNECT_SHARE_TOKEN_EVENT_NAMES')).toEqual(SHARE_TOKEN_EVENTS);
    expect(pick('CONNECT_CONNECTION_EVENT_NAMES')).toEqual(CONNECTION_EVENTS);
    expect(pick('CONSENT_RECORD_EVENT_NAMES')).toEqual(CONSENT_RECORD_EVENTS);
    expect(pick('CONNECT_EVENT_NAMES')).toEqual(CONNECT_EVENTS);
    expect(contracts.EVENT_NAMES as readonly string[]).not.toContain('connect/share-token.ready');
  });

  it.each(CONNECT_EVENTS)('holds %s in EVENT_NAMES', (name) => {
    expect(contracts.EVENT_NAMES as readonly string[]).toContain(name);
    expect(contracts.isEventName(name)).toBe(true);
    // The events table's name check (migration 0001) takes one `/` head.
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    expect(name).toMatch(/^[a-z][a-z_-]*(\/[a-z][a-z_-]*)?(\.[a-z][a-z_-]*)+$/);
  });

  it('gives every event name a subject: the head of a connect/ name is its own (C239.4)', () => {
    for (const name of contracts.EVENT_NAMES) {
      const head = name.slice(0, name.indexOf('.'));
      const expected = head.startsWith('report/') ? 'report' : head;
      expect(contracts.eventSubject(name), name).toBe(expected);
      expect(contracts.eventResourceType(name), name).toBe(head);
    }
    for (const name of CONNECT_EVENTS) {
      const head = name.slice(0, name.indexOf('.'));
      expect(contracts.eventSubject(name as contracts.EventName)).toBe(head);
    }
  });

  it.each(CONNECT_EVENTS)('holds a sample of %s whose payload is the event resource', (name) => {
    const raw = readFixture(sampleFile(name));
    const document = contracts.eventDocumentSchema.parse(raw);
    expect(z.encode(contracts.eventDocumentSchema, document)).toEqual(raw);
    expect(document.data.attributes.name).toBe(name);
    expect(document.data.attributes.payload.data.type).toBe(name.slice(0, name.indexOf('.')));
  });

  it('serves each share-token event as the receiving side sees the token (C239.2)', () => {
    const direction = (name: string): unknown =>
      (
        readFixture(sampleFile(name)) as {
          data: { attributes: { payload: { data: { attributes: { direction: string } } } } };
        }
      ).data.attributes.payload.data.attributes.direction;
    expect(direction('connect/share-token.outbound-created')).toBe('outbound');
    expect(direction('connect/share-token.outbound-redeemed')).toBe('outbound');
    expect(direction('connect/share-token.inbound-created')).toBe('inbound');
    expect(direction('connect/share-token.inbound-redeemed')).toBe('inbound');
    expect(direction('connect/share-token.consent-withdrawn')).toBe('inbound');
    expect(direction('connect/share-token.source-redacted')).toBe('inbound');
  });

  const eventWith = (name: string, change: (attributes: Record<string, unknown>) => void) => {
    const raw = structuredClone(readFixture(sampleFile(name))) as {
      data: { attributes: { payload: { data: { attributes: Record<string, unknown> } } } };
    };
    change(raw.data.attributes.payload.data.attributes);
    return contracts.eventDocumentSchema.safeParse(raw).success;
  };

  it('refuses an event that carries shared data, consent evidence or the agreement reference (rule 11)', () => {
    expect(eventWith('connect/share-token.inbound-created', () => undefined)).toBe(true);
    expect(
      eventWith('connect/share-token.inbound-created', (attributes) => {
        attributes['source-data'] = {
          type: 'connect/source-data/account',
          attributes: {},
          fields: { name_first: { visibility: 'full', value: 'Jane' } },
        };
      }),
    ).toBe(false);
    for (const member of ['evidence-reference', 'ip-address', 'user-agent', 'text-body']) {
      expect(
        eventWith('consent-record.created', (attributes) => {
          attributes[member] = 'synthetic value';
        }),
        member,
      ).toBe(false);
    }
    expect(
      eventWith('connect/connection.created', (attributes) => {
        attributes['agreement-reference'] = 'Synthetic agreement';
      }),
    ).toBe(false);
  });

  it('adds the three resource types', () => {
    for (const type of ['connect/connection', 'connect/share-token', 'consent-record']) {
      expect(contracts.RESOURCE_TYPES as readonly string[]).toContain(type);
    }
  });
});

describe('provenance on an inquiry payload (C235.1, C235.7(a))', () => {
  const sample = () =>
    readFixture('api/connect/event-inquiry-cloned.json') as {
      data: {
        attributes: {
          payload: { data: { attributes: Record<string, unknown> } };
        };
      };
    };

  it('holds a cloned-inquiry sample: an inquiry event with connect-clone provenance, in review', () => {
    const raw = sample();
    const document = contracts.eventDocumentSchema.parse(raw);
    expect(z.encode(contracts.eventDocumentSchema, document)).toEqual(raw);
    const attributes = raw.data.attributes.payload.data.attributes;
    expect(attributes.status).toBe('needs_review');
    expect(attributes.provenance).toEqual({
      kind: 'connect-clone',
      'share-token-id': 'cnst_01M5CN0000000000000011A200',
      'source-organization-name': 'Example Source',
      'source-environment-kind': 'sandbox',
      'source-created-at': '2026-10-20T12:00:00.000Z',
      'source-status': 'approved',
      'cloned-at': '2026-10-20T12:15:20.000Z',
    });
  });

  it('leaves provenance out of an inquiry that is no copy, and never discloses a source id', () => {
    const plain = readFixture('api/inquiry.json') as {
      data: { attributes: Record<string, unknown> };
    };
    expect(Object.hasOwn(plain.data.attributes, 'provenance')).toBe(false);
    expect(contracts.inquiryDocumentSchema.safeParse(plain).success).toBe(true);
    const provenance = schema('provenanceSchema');
    const clone = sample().data.attributes.payload.data.attributes.provenance as Record<
      string,
      unknown
    >;
    expect(provenance.safeParse(clone).success).toBe(true);
    expect(
      provenance.safeParse({ ...clone, 'source-id': 'inq_01M5CJXHG07XPHF3HRM6NREDH7' }).success,
    ).toBe(false);
    expect(provenance.safeParse({ ...clone, kind: 'fresh' }).success).toBe(false);
  });

  it('takes a hydrate provenance with the keys that were filled, never a value', () => {
    const provenance = schema('provenanceSchema');
    const hydrate = {
      kind: 'connect-hydrate',
      'share-token-id': 'cnst_01M5CN0000000000000011A200',
      'source-organization-name': 'Example Source',
      'hydrated-at': '2026-10-20T12:15:20.000Z',
      fields: ['name_first', 'address.city'],
    };
    expect(provenance.parse(hydrate)).toEqual(hydrate);
    expect(provenance.safeParse({ ...hydrate, fields: [{ name_first: 'Jane' }] }).success).toBe(
      false,
    );
    expect(
      provenance.parse({ ...hydrate, 'consent-withdrawn-at': '2026-10-20T12:40:00.000Z' }),
    ).toMatchObject({ 'consent-withdrawn-at': '2026-10-20T12:40:00.000Z' });
  });
});

describe("Connect's environment settings (C232.1, C241.3)", () => {
  it('bounds share-token-max-seconds to the public range, 21 days by default', () => {
    expect(pick('SHARE_TOKEN_MAX_SECONDS')).toEqual({
      min: 60,
      max: 1_814_400,
      default: 1_814_400,
    });
  });

  it('bounds consent-proof-retention-days to 0-3,650, none kept by default', () => {
    expect(pick('CONSENT_PROOF_RETENTION_DAYS')).toEqual({ min: 0, max: 3650, default: 0 });
  });

  it('serves both with their defaults', () => {
    expect(contracts.DASHBOARD_SETTINGS_DEFAULTS).toMatchObject({
      'share-token-max-seconds': 1_814_400,
      'consent-proof-retention-days': 0,
    });
    const resolve = pick('resolveConnectSettings') as
      ((stored: Record<string, unknown>) => unknown) | undefined;
    expect(resolve?.({})).toEqual({
      'share-token-max-seconds': 1_814_400,
      'consent-proof-retention-days': 0,
    });
    expect(
      resolve?.({ 'share-token-max-seconds': 3600, 'consent-proof-retention-days': 365 }),
    ).toEqual({ 'share-token-max-seconds': 3600, 'consent-proof-retention-days': 365 });
  });

  it.each([
    ['share-token-max-seconds', 60, 1_814_400, 59, 1_814_401],
    ['consent-proof-retention-days', 0, 3650, -1, 3651],
  ] as const)('takes %s between %d and %d in an update', (key, min, max, below, above) => {
    const body = contracts.dashboardUpdateSettingsBodySchema;
    expect(body.safeParse({ [key]: min }).success).toBe(true);
    expect(body.safeParse({ [key]: max }).success).toBe(true);
    expect(body.safeParse({ [key]: below }).success).toBe(false);
    expect(body.safeParse({ [key]: above }).success).toBe(false);
    expect(body.safeParse({ [key]: 1.5 }).success).toBe(false);
  });
});
