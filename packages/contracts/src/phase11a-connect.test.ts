/**
 * Phase 11, Workflow 11A Stage 1a, the (C) checkpoint (C230-C233): the share policy with its rules
 * and JSON-pointer issues, the peek path, the connection and the share token as each side sees
 * them, the peek envelope per subtype, and the bodies and queries of their routes. Everything is
 * read through the package root, so the export lines are held too.
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
const clone = <T>(value: T): T => structuredClone(value);
type Json = Record<string, unknown>;
const issuePaths = (result: z.ZodSafeParseResult<unknown>): PropertyKey[][] =>
  result.success ? [] : result.error.issues.map((issue) => issue.path);

const POLICY = readFixture('api/connect/share-policy.json') as Json;
const policyWith = (change: (policy: Json) => void): Json => {
  const policy = clone(POLICY);
  change(policy);
  return policy;
};

describe('the peek path (C230.3, C233.2)', () => {
  it.each([
    'inquiry.status',
    'inquiry.fields.name_first',
    'account.fields.name-first',
    'transaction.fields.amount',
    'verification/government-id.name-first',
    'verification/phone-number.status',
  ])('accepts %s', (path) => {
    expect(schema('sharePeekPathSchema').safeParse(path).success).toBe(true);
  });

  it.each([
    'inquiry',
    'inquiry.',
    'inquiry.fields.',
    'report.status',
    'verification/passport.status',
    'verification/selfie.fields.name',
    'inquiry.Status',
    `inquiry.${'a'.repeat(65)}`,
  ])('refuses %s', (path) => {
    expect(schema('sharePeekPathSchema').safeParse(path).success).toBe(false);
  });

  it('splits a path into its subtype and its attribute or field key', () => {
    const parse = pick('parsePeekPath') as (path: string) => unknown;
    expect(parse('inquiry.fields.name_first')).toEqual({
      subtype: 'inquiry',
      fieldKey: 'name_first',
      attribute: null,
    });
    expect(parse('verification/government-id.name-first')).toEqual({
      subtype: 'verification/government-id',
      fieldKey: null,
      attribute: 'name-first',
    });
  });
});

describe('the share policy (C230.3)', () => {
  it('accepts the golden policy and defaults attested-consent to non-biometric', () => {
    expect(schema('sharePolicySchema').parse(POLICY)).toEqual(POLICY);
    const withoutMode = policyWith((policy) => {
      delete policy['attested-consent'];
    });
    expect(schema('sharePolicySchema').parse(withoutMode)).toMatchObject({
      'attested-consent': 'non-biometric',
    });
  });

  it('needs biometric for a selfie and points at the selfie (share_policy_invalid)', () => {
    const policy = policyWith((body) => {
      body.biometric = false;
      body.peek = {};
    });
    expect(issuePaths(schema('sharePolicySchema').safeParse(policy))).toEqual([
      ['verifications', 'types', 1],
    ]);
  });

  it('refuses a peek path the policy does not share, at that path', () => {
    const policy = policyWith((body) => {
      body.peek = {
        'inquiry.fields.name_first': 'full',
        'inquiry.fields.tax_number': 'full',
        'transaction.status': 'presence',
        'verification/document.status': 'full',
      };
    });
    expect(issuePaths(schema('sharePolicySchema').safeParse(policy))).toEqual([
      ['peek', 'inquiry.fields.tax_number'],
      ['peek', 'transaction.status'],
      ['peek', 'verification/document.status'],
    ]);
  });

  it('allows at most 400 peek paths', () => {
    const peek = Object.fromEntries(
      Array.from({ length: 401 }, (_, index) => [`inquiry.attribute-${String(index)}`, 'full']),
    );
    const paths = issuePaths(
      schema('sharePolicySchema').safeParse(policyWith((body) => (body.peek = peek))),
    );
    expect(paths).toContainEqual(['peek']);
  });

  it('needs a verification type when it shares verifications as sources', () => {
    const policy = policyWith((body) => {
      body['source-types'] = ['verification'];
      body.verifications = { ...(body.verifications as Json), types: [] };
      body.peek = {};
    });
    expect(issuePaths(schema('sharePolicySchema').safeParse(policy))).toEqual([
      ['verifications', 'types'],
    ]);
  });

  it.each([
    ['a wildcard field', (body: Json) => ((body.fields as Json).inquiry = ['*'])],
    ['a duplicate field', (body: Json) => ((body.fields as Json).account = ['a', 'a'])],
    ['a second purpose', (body: Json) => (body.purpose = 'share.marketing')],
    ['no source type', (body: Json) => (body['source-types'] = [])],
    ['a report source', (body: Json) => (body['source-types'] = ['report'])],
    ['an unknown member', (body: Json) => (body.templates = true)],
    ['a face template', (body: Json) => (body['face-templates'] = true)],
  ])('refuses %s', (_name, change) => {
    expect(schema('sharePolicySchema').safeParse(policyWith(change)).success).toBe(false);
  });

  it('holds a stored version to the same rules', () => {
    const version = {
      id: 'cxnp_01M5CN0000000000000011A110',
      version: 1,
      'created-at': '2026-10-20T12:00:00.000Z',
      body: policyWith((body) => (body.biometric = false)),
    };
    expect(schema('sharePolicyVersionSchema').safeParse(version).success).toBe(false);
  });
});

const CONNECTIONS = [
  'connection-source.json',
  'connection-pending-source.json',
  'connection-destination.json',
  'connection-self.json',
] as const;

describe('the connection as each side sees it (C230.2)', () => {
  it.each(CONNECTIONS)('reads api/connect/%s', (name) => {
    expect(
      schema('connectionDocumentSchema').safeParse(readFixture(`api/connect/${name}`)).success,
    ).toBe(true);
  });

  it('never serves the agreement reference to the source', () => {
    const document = clone(readFixture('api/connect/connection-source.json')) as {
      data: { attributes: Json };
    };
    document.data.attributes['agreement-reference'] = 'Synthetic agreement';
    expect(issuePaths(schema('connectionDocumentSchema').safeParse(document))).toEqual([
      ['data', 'attributes', 'agreement-reference'],
    ]);
  });

  it('never serves the creator to the destination (review P26)', () => {
    const document = clone(readFixture('api/connect/connection-destination.json')) as {
      data: { relationships: Json };
    };
    document.data.relationships.creator = {
      data: { type: 'user', id: 'usr_01M5CN0000000000000011A030' },
    };
    expect(issuePaths(schema('connectionDocumentSchema').safeParse(document))).toEqual([
      ['data', 'relationships', 'creator'],
    ]);
  });

  it("keeps the destination's name from the source until a first activation (review P09)", () => {
    const pending = readFixture('api/connect/connection-pending-source.json') as {
      data: { attributes: Json };
    };
    expect(pending.data.attributes).toMatchObject({
      status: 'pending',
      'destination-organization-name': null,
      'activated-at': null,
    });
  });
});

describe('the share token as each side sees it (C232.3)', () => {
  it.each([
    'share-token-outbound.json',
    'share-token-inbound.json',
    'share-token-inbound-redeemed.json',
    'share-token-peek.json',
  ])('reads api/connect/%s', (name) => {
    expect(
      schema('shareTokenDocumentSchema').safeParse(readFixture(`api/connect/${name}`)).success,
    ).toBe(true);
  });

  it.each(['creator', 'source', 'consent-record'])(
    'never serves %s to the destination',
    (relationship) => {
      const outbound = readFixture('api/connect/share-token-outbound.json') as {
        data: { relationships: Json };
      };
      const document = clone(readFixture('api/connect/share-token-inbound.json')) as {
        data: { relationships: Json };
      };
      document.data.relationships[relationship] = outbound.data.relationships[relationship];
      expect(issuePaths(schema('shareTokenDocumentSchema').safeParse(document))).toEqual([
        ['data', 'relationships', relationship],
      ]);
    },
  );

  it('names a workflow run as the creator of a token a workflow step made (C243.1; integration-11a)', () => {
    const document = clone(readFixture('api/connect/share-token-outbound.json')) as {
      data: { relationships: Json };
    };
    document.data.relationships.creator = {
      data: { type: 'workflow-run', id: 'wfr_01M5CN0000000000000011A700' },
    };
    expect(schema('shareTokenDocumentSchema').safeParse(document).success).toBe(true);
  });

  it('names the destination object only once the token is redeemed', () => {
    const redeemed = readFixture('api/connect/share-token-inbound-redeemed.json') as {
      data: { relationships: Json };
    };
    const document = clone(readFixture('api/connect/share-token-inbound.json')) as {
      data: { relationships: Json };
    };
    document.data.relationships.destination = redeemed.data.relationships.destination;
    expect(issuePaths(schema('shareTokenDocumentSchema').safeParse(document))).toEqual([
      ['data', 'relationships', 'destination'],
    ]);
  });

  it('carries source-data only for a created token', () => {
    const document = clone(readFixture('api/connect/share-token-peek.json')) as {
      data: { attributes: Json };
    };
    document.data.attributes.status = 'expired';
    document.data.attributes['expired-at'] = '2026-10-21T12:00:00.000Z';
    document.data.attributes['expiry-reason'] = 'source_expired';
    expect(issuePaths(schema('shareTokenDocumentSchema').safeParse(document))).toEqual([
      ['data', 'attributes', 'source-data'],
    ]);
  });
});

const SUBTYPE_FIXTURES: Readonly<Record<string, string>> = {
  inquiry: 'source-data-inquiry.json',
  account: 'source-data-account.json',
  transaction: 'source-data-transaction.json',
  'verification/government-id': 'source-data-verification-government-id.json',
  'verification/selfie': 'source-data-verification-selfie.json',
  'verification/database': 'source-data-verification-database.json',
  'verification/document': 'source-data-verification-document.json',
  'verification/email-address': 'source-data-verification-email-address.json',
  'verification/phone-number': 'source-data-verification-phone-number.json',
};

describe('the peek envelope (C233.2, C233.3)', () => {
  it('holds one golden envelope per subtype, and no other', () => {
    expect(Object.keys(SUBTYPE_FIXTURES)).toEqual([...contracts.SOURCE_DATA_SUBTYPES]);
    expect(listFixtures('api/connect').filter((name) => name.startsWith('source-data-'))).toEqual(
      Object.values(SUBTYPE_FIXTURES).sort(),
    );
  });

  it.each(Object.entries(SUBTYPE_FIXTURES))('reads the %s envelope', (subtype, name) => {
    const envelope = readFixture(`api/connect/${name}`);
    expect(schema('sourceDataSchema').parse(envelope)).toMatchObject({
      type: `connect/source-data/${subtype}`,
    });
    expect((pick('sourceDataType') as (subtype: string) => string)(subtype)).toBe(
      `connect/source-data/${subtype}`,
    );
  });

  it('serves every attribute as {visibility, value}, a presence as a boolean', () => {
    const envelope = clone(readFixture('api/connect/source-data-account.json')) as {
      fields: Json;
      attributes: Json;
    };
    envelope.fields.name_first = { visibility: 'presence', value: 'Alex' };
    expect(issuePaths(schema('sourceDataSchema').safeParse(envelope))).not.toEqual([]);
    const bare = clone(readFixture('api/connect/source-data-account.json')) as { attributes: Json };
    bare.attributes.status = 'active';
    expect(schema('sourceDataSchema').safeParse(bare).success).toBe(false);
  });

  it('never carries a file, an image or face data, only whether one exists (C233.3)', () => {
    const envelope = clone(
      readFixture('api/connect/source-data-verification-government-id.json'),
    ) as Json;
    envelope.files = { visibility: 'full', value: 'c3ludGhldGlj' };
    expect(schema('sourceDataSchema').safeParse(envelope).success).toBe(false);
    const face = clone(readFixture('api/connect/source-data-verification-selfie.json')) as Json;
    face['face-template'] = { visibility: 'full', value: [0.1, 0.2] };
    expect(schema('sourceDataSchema').safeParse(face).success).toBe(false);
  });

  it('gives fields and related objects to an inquiry only', () => {
    const envelope = clone(
      readFixture('api/connect/source-data-verification-database.json'),
    ) as Json;
    envelope.fields = {};
    expect(schema('sourceDataSchema').safeParse(envelope).success).toBe(false);
    const account = clone(readFixture('api/connect/source-data-account.json')) as Json;
    account['related-objects'] = [];
    expect(schema('sourceDataSchema').safeParse(account).success).toBe(false);
  });
});

const doc = (type: string, attributes: Json): Json => ({ data: { type, attributes } });

describe('the connection routes (C231)', () => {
  it('creates a connection with a destination and a policy, both required', () => {
    const create = schema('createConnectionBodySchema');
    const attributes = {
      'destination-organization-id': 'org_01M5CN0000000000000011A020',
      'share-policy': POLICY,
    };
    expect(create.safeParse(doc('connect/connection', attributes)).success).toBe(true);
    expect(
      create.safeParse(
        doc('connect/connection', {
          'destination-organization-id': attributes['destination-organization-id'],
        }),
      ).success,
    ).toBe(false);
    const invalid = create.safeParse(
      doc('connect/connection', {
        ...attributes,
        'share-policy': policyWith((body) => (body.biometric = false)),
      }),
    );
    expect(issuePaths(invalid)[0]?.slice(0, 4)).toEqual([
      'data',
      'attributes',
      'share-policy',
      'verifications',
    ]);
  });

  it('activates with the current version, an agreement reference and an acknowledgement', () => {
    const activate = schema('activateConnectionBodySchema');
    const attributes = {
      'policy-version': 1,
      'agreement-reference': 'Synthetic agreement DSA-TEST-A',
      acknowledged: true,
    };
    expect(activate.safeParse(doc('connect/connection', attributes)).success).toBe(true);
    for (const bad of [
      { ...attributes, acknowledged: false },
      { ...attributes, 'agreement-reference': '' },
      { ...attributes, 'agreement-reference': 'x'.repeat(501) },
      { ...attributes, 'policy-version': 0 },
    ]) {
      expect(activate.safeParse(doc('connect/connection', bad)).success).toBe(false);
    }
  });

  it('changes the policy with a whole new body', () => {
    expect(
      schema('changeSharePolicyBodySchema').safeParse(
        doc('connect/connection', { 'share-policy': POLICY }),
      ).success,
    ).toBe(true);
  });

  it('lists by status and destination, and takes a cxn_ id in the path', () => {
    expect(
      schema('listConnectionsQuerySchema').safeParse({
        'filter[status]': 'pending,active',
        'filter[destination-organization-id]': 'org_01M5CN0000000000000011A020',
      }).success,
    ).toBe(true);
    expect(
      schema('listConnectionsQuerySchema').safeParse({ 'filter[status]': 'gone' }).success,
    ).toBe(false);
    expect(
      schema('connectionParamsSchema').safeParse({ id: 'cxn_01M5CN0000000000000011A100' }).success,
    ).toBe(true);
    expect(
      schema('connectionParamsSchema').safeParse({ id: 'cnst_01M5CN0000000000000011A200' }).success,
    ).toBe(false);
  });
});

describe('the share-token routes (C232, C233)', () => {
  const attributes = {
    'connection-id': 'cxn_01M5CN0000000000000011A100',
    'source-id': 'inq_01M5CN0000000000000011A300',
    'consent-record-id': 'cnsr_01M5CN0000000000000011A400',
  };

  it('creates a token citing a consent record, which is required (decision 19)', () => {
    const create = schema('createShareTokenBodySchema');
    expect(create.safeParse(doc('connect/share-token', attributes)).success).toBe(true);
    const withoutConsent: Json = { ...attributes };
    delete withoutConsent['consent-record-id'];
    expect(create.safeParse(doc('connect/share-token', withoutConsent)).success).toBe(false);
  });

  it('takes expires-in-seconds from 60 to 1,814,400 (the public range)', () => {
    const create = schema('createShareTokenBodySchema');
    for (const [seconds, ok] of [
      [59, false],
      [60, true],
      [1_814_400, true],
      [1_814_401, false],
    ] as const) {
      expect(
        create.safeParse(
          doc('connect/share-token', { ...attributes, 'expires-in-seconds': seconds }),
        ).success,
      ).toBe(ok);
    }
  });

  it('accepts a report id in the body, so the route answers share_source_not_supported', () => {
    expect(
      schema('createShareTokenBodySchema').safeParse(
        doc('connect/share-token', {
          ...attributes,
          'source-id': 'rep_01M5CN0000000000000011A500',
        }),
      ).success,
    ).toBe(true);
  });

  it('lists by connection, status and direction', () => {
    const list = schema('listShareTokensQuerySchema');
    expect(
      list.safeParse({
        'filter[connection-id]': 'cxn_01M5CN0000000000000011A100',
        'filter[status]': 'created,redeemed',
        'filter[direction]': 'inbound',
      }).success,
    ).toBe(true);
    expect(list.safeParse({ 'filter[direction]': 'self' }).success).toBe(false);
  });

  it('peeks with peek-source-data=true (the public parameter)', () => {
    // The query's boolean filters stay the strings `true` and `false`, as every list filter is.
    expect(schema('getShareTokenQuerySchema').parse({ 'peek-source-data': 'true' })).toEqual({
      'peek-source-data': 'true',
    });
    expect(
      schema('getShareTokenQuerySchema').safeParse({ 'peek-source-data': 'yes' }).success,
    ).toBe(false);
    expect(schema('getShareTokenQuerySchema').safeParse({ peek: 'true' }).success).toBe(false);
    expect(
      schema('shareTokenParamsSchema').safeParse({ id: 'cnst_01M5CN0000000000000011A200' }).success,
    ).toBe(true);
  });
});
