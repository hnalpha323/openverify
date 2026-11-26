/** C114.4 (H27): `trigger` is a flattened view of the event's document, typed and read the same way. */
import { PII_MASKED_ATTRIBUTES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { readWorkflowFixture } from '../definition/testing.js';
import { resolvePath, type ScopeType } from '../variables/types.js';
import {
  buildTriggerView,
  eventViewType,
  MASKED_ATTRIBUTE_NAMES,
  relatedNeededBy,
  triggerViewType,
  type JsonApiResource,
  type TriggerDocument,
} from './trigger-view.js';
import { parsePath, readSegments } from './paths.js';
import type { JsonRecord, JsonValue } from './json.js';

const INQUIRY = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const TEMPLATE = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6';
const ACCOUNT = 'acc_01M5CK3190XEVBM5ZXA76E1JSN';
const OLD = 'ver_01M5CK3190XEVBM5ZXA76E1JSM';
const NEW = 'ver_01M5CK3190XEVBM5ZXA76E1JSN';

const document: TriggerDocument = {
  data: {
    type: 'inquiry',
    id: INQUIRY,
    attributes: {
      status: 'completed',
      'reference-id': 'ref-1',
      fields: { first_name: 'Ada', 'odd-key': 1 },
      tags: ['vip'],
      signals: [{ name: 'inquiry/bot_score', value: 12 }],
      'created-at': '2026-10-20T12:00:00.000Z',
    },
    relationships: {
      'inquiry-template': { data: { type: 'inquiry-template', id: TEMPLATE } },
      account: { data: { type: 'account', id: ACCOUNT } },
      verifications: {
        data: [
          { type: 'verification/government-id', id: OLD },
          { type: 'verification/government-id', id: NEW },
        ],
      },
    },
  },
  included: [
    {
      type: 'verification/government-id',
      id: OLD,
      attributes: {
        status: 'failed',
        country: 'FR',
        'created-at': '2026-10-19T00:00:00.000Z',
      },
    },
    {
      type: 'verification/government-id',
      id: NEW,
      attributes: {
        status: 'passed',
        country: 'US',
        'created-at': '2026-10-20T00:00:00.000Z',
      },
    },
  ],
};

const related: readonly JsonApiResource[] = [
  { type: 'account', id: ACCOUNT, attributes: { 'reference-id': 'acct-1', fields: {} } },
];

const read = (text: string): JsonValue | undefined =>
  readSegments(buildTriggerView(document, related), parsePath(text)?.segments ?? []);

function typeOf(event: string): ScopeType {
  const type = eventViewType(event);
  if (type === null) {
    throw new Error(`no view of ${event}`);
  }
  return type;
}

describe('the value of the view (C114.4)', () => {
  it.each<[string, JsonValue]>([
    ['status', 'completed'],
    ['id', INQUIRY],
    ['type', 'inquiry'],
    ['fields.first_name', 'Ada'],
    ['reference-id', 'ref-1'],
    ['reference_id', 'ref-1'],
    ['created_at', '2026-10-20T12:00:00.000Z'],
    ['template.id', TEMPLATE],
    ['template.token', TEMPLATE],
    ['token', INQUIRY],
    ['inquiry-template.id', TEMPLATE],
    ['account.id', ACCOUNT],
    ['account.reference-id', 'acct-1'],
    ['verifications[0].id', OLD],
    ['verifications[1].type', 'verification/government-id'],
    ['verification_government_id.country', 'US'],
    ['verification_government_id.id', NEW],
  ])('%s', (path, expected) => {
    expect(read(path)).toEqual(expected);
  });

  it('never inflects the keys of fields', () => {
    expect(read('fields.odd-key')).toBe(1);
    expect(read('fields.odd_key')).toBeUndefined();
  });

  it('reads a verification the inquiry does not have as null', () => {
    expect(read('verification_selfie')).toBeNull();
  });

  it('holds one member per signal, null when the array does not hold it (Stage 1a amendment 10)', () => {
    expect(read('signals.bot_score')).toBe(12);
    expect(read('signals.behavior_threat_level')).toBeNull();
  });

  it('reads an empty signals array as nulls, never as false', () => {
    const hidden = buildTriggerView({
      data: { type: 'inquiry', id: INQUIRY, attributes: { signals: [] } },
    });
    expect(readSegments(hidden, ['signals', 'bot_score'])).toBeNull();
  });

  it('reads a to-one relationship with no related resource as its identifier', () => {
    expect(read('template')).toEqual({
      id: TEMPLATE,
      type: 'inquiry-template',
      token: TEMPLATE,
    });
  });

  it('reads a null relationship as null', () => {
    const bare = buildTriggerView({
      data: {
        type: 'inquiry',
        id: INQUIRY,
        attributes: {},
        relationships: { account: { data: null } },
      },
    });
    expect(readSegments(bare, ['account'])).toBeNull();
  });

  it('reads the primary resource as its own verification alias', () => {
    const verification = buildTriggerView({
      data: {
        type: 'verification/government-id',
        id: NEW,
        attributes: { country: 'US' },
      },
    });
    expect(readSegments(verification, ['verification_government_id', 'country'])).toBe('US');
  });

  it('adds nothing to the prototype, whatever a key is called', () => {
    const attributes = JSON.parse('{"__proto__": {"x": 1}}') as unknown;
    const built = buildTriggerView({ data: { type: 'inquiry', id: INQUIRY, attributes } });
    expect(Object.getPrototypeOf(built)).toBe(Object.prototype);
    expect(readSegments(built, ['x'])).toBeUndefined();
  });

  it('keeps a stub of a redacted subject', () => {
    const stub = buildTriggerView({
      data: {
        type: 'inquiry',
        id: INQUIRY,
        attributes: { 'redacted-at': '2026-10-20T00:00:00.000Z' },
      },
    });
    expect(readSegments(stub, ['redacted-at'])).toBe('2026-10-20T00:00:00.000Z');
    expect(readSegments(stub, ['status'])).toBeUndefined();
  });
});

describe('the type of the view (C114.4, C114.5)', () => {
  const resolve = (text: string) =>
    resolvePath(typeOf('inquiry.completed'), parsePath(text)?.segments ?? []);

  it.each<[string, object]>([
    ['status', { type: { kind: 'enum' } }],
    ['id', { type: { kind: 'id', prefix: 'inq' } }],
    ['template.id', { type: { kind: 'id', prefix: 'itmpl' } }],
    ['template.token', { type: { kind: 'id', prefix: 'itmpl' } }],
    ['account.id', { type: { kind: 'id', prefix: 'acc' }, nullable: true }],
    ['account.reference-id', { nullable: true }],
    ['verification_government_id.country', { nullable: true }],
    ['signals.bot_score', { nullable: true }],
    ['tags[0]', { type: { kind: 'string' }, nullable: true }],
    ['verifications[0].id', { type: { kind: 'id', prefix: 'ver' } }],
  ])('%s', (path, expected) => {
    expect(resolve(path)).toMatchObject({ ok: true, ...expected });
  });

  it('marks PII by the contract and by the masked names', () => {
    expect(resolve('fields.first_name')).toMatchObject({ ok: true, pii: true, nullable: true });
    expect(resolve('note')).toMatchObject({ ok: true, pii: true });
    expect(resolve('status')).toMatchObject({ ok: true, pii: false });
    expect(resolve('account.fields.x')).toMatchObject({ ok: true, pii: true });
  });

  it('refuses an unknown public name (C114.4)', () => {
    expect(resolve('verification_passport.status')).toMatchObject({ ok: false });
    expect(resolve('status.nope')).toMatchObject({ ok: false });
  });

  it('reads a report event by its own type', () => {
    expect(resolvePath(typeOf('report/watchlist.ready'), ['status'])).toMatchObject({ ok: true });
  });

  it('has no view of an event it does not know', () => {
    expect(eventViewType('no-such.event')).toBeNull();
    expect(triggerViewType('no-such-type')).toBeNull();
  });

  it('holds a view for every resource an event can carry', () => {
    for (const name of [
      'account.created',
      'transaction.created',
      'list.updated',
      'verification.passed',
      'graph-query.completed',
    ]) {
      expect(eventViewType(name), name).not.toBeNull();
    }
  });
});

describe('the value and the type agree', () => {
  const payload = readWorkflowFixture('../api/event-inquiry-reopened.json') as {
    data: { attributes: { payload: TriggerDocument } };
  };

  it('reads every member of a golden event by a path its type allows', () => {
    const built = buildTriggerView(payload.data.attributes.payload);
    const type = typeOf('inquiry.reopened');
    for (const member of Object.keys(built)) {
      if (!member.includes('_') || member.startsWith('verification_')) {
        expect(resolvePath(type, [member]), member).toMatchObject({ ok: true });
      }
    }
  });
});

describe('the public country code (C114.4)', () => {
  const government = {
    data: {
      type: 'inquiry',
      id: 'inq_1',
      attributes: { status: 'completed' },
      relationships: {
        verifications: { data: [{ type: 'verification/government-id', id: 'ver_1' }] },
      },
    },
    included: [{ type: 'verification/government-id', id: 'ver_1', attributes: { country: 'NL' } }],
  } as unknown as TriggerDocument;

  it('reads the plan’s own example: a member the table names, on the value and the type', () => {
    const view = buildTriggerView(government) as { verification_government_id: JsonRecord };

    expect(view.verification_government_id.country_code).toBe('NL');
    expect(
      resolvePath(typeOf('inquiry.completed'), ['verification_government_id', 'country_code']),
    ).toMatchObject({ ok: true });
  });
});

describe('what a run snapshots (C114.4)', () => {
  const needs = (...paths: readonly string[]) =>
    relatedNeededBy(paths.map((path) => parsePath(path)?.segments ?? []));

  it('names the related resources a version reads past their id', () => {
    expect(needs('trigger.account.reference-id', 'trigger.template.name')).toEqual({
      relationships: ['account', 'inquiry-template'],
      verifications: [],
    });
  });

  it('names the verifications a version reads', () => {
    expect(needs('trigger.verification_government_id.country')).toEqual({
      relationships: [],
      verifications: ['verification/government-id'],
    });
  });

  it('needs nothing for what the event holds', () => {
    expect(
      needs('trigger.status', 'trigger.template.id', 'trigger.account.token', 'vars.x'),
    ).toEqual({
      relationships: [],
      verifications: [],
    });
  });
});

describe('the run taint’s masked names (Workflow 8C review K8-11)', () => {
  it('are the contracts’ one list, which the API masks by', () => {
    expect([...MASKED_ATTRIBUTE_NAMES].sort()).toEqual([...PII_MASKED_ATTRIBUTES].sort());
  });

  it('taint a sandbox message’s text in a trigger view, as the API masks it', () => {
    expect(MASKED_ATTRIBUTE_NAMES.has('message-text')).toBe(true);
  });
});
