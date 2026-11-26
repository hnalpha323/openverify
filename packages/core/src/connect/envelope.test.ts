/**
 * C233.2, C233.3 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 2): the peek envelope.
 * Tables per subtype, then seeded properties: with no `full` entry nothing but booleans is served,
 * a `full` value only ever sits at a path the policy shares and names `full`, and no file id, file
 * byte or face template reaches an envelope.
 */
import { describe, expect, it } from 'vitest';
import { seededRandom, type SeededRandom } from '../analytics/testing/random.js';
import { SHARE_FIELD_TYPES } from './categories.js';
import type { ShareSourceContent, ShareVerificationEntry } from './content.js';
import {
  SOURCE_DATA_RELATED_OBJECTS_MAX,
  sourceDataOf,
  type PeekAttributeValue,
  type SourceDataEnvelope,
} from './envelope.js';
import {
  SHARE_FILE_KINDS,
  SHARE_SOURCE_KINDS,
  SHARE_VERIFICATION_KINDS,
  VERIFICATION_TYPE_OF_SHARE_KIND,
  peekPathShared,
  type SharePeekVisibility,
  type SharePolicyRules,
} from './policy.js';
import {
  EVERYTHING,
  check,
  emailAddress,
  field,
  file,
  governmentId,
  inquiryContent,
  inquiryObject,
  policyWith,
  selfie,
  verificationsWith,
} from './testing.js';

const full = (value: unknown): PeekAttributeValue => ({ visibility: 'full', value });
const presence = (value: boolean): PeekAttributeValue => ({ visibility: 'presence', value });

const PEEK: Readonly<Record<string, SharePeekVisibility>> = {
  'inquiry.status': 'full',
  'inquiry.fields.name_first': 'full',
  'inquiry.fields.proof': 'full',
  'inquiry.fields.loyalty_points': 'full',
  'verification/government-id.status': 'full',
  'verification/government-id.name-first': 'full',
  'verification/government-id.checks': 'full',
  'verification/selfie.status': 'full',
  'verification/selfie.liveness-score': 'full',
};

const envelopeOf = (policy: SharePolicyRules, content: ShareSourceContent): SourceDataEnvelope => {
  const envelope = sourceDataOf(policy, content);
  if (envelope === null) throw new Error('expected an envelope');
  return envelope;
};

describe('an inquiry’s envelope (C233.2)', () => {
  it('serves each shared attribute as its value or its presence, with related objects', () => {
    const content = inquiryContent([
      governmentId(),
      selfie({ attributes: { 'liveness-score': 0.97, 'center-photo-face-coordinates': [1, 2] } }),
      emailAddress(),
    ]);
    expect(envelopeOf(policyWith({ peek: PEEK }), content)).toEqual({
      type: 'connect/source-data/inquiry',
      attributes: {
        status: full('approved'),
        'created-at': presence(true),
        'decisioned-at': presence(true),
      },
      fields: {
        name_first: full('Alex'),
        email_address: presence(true),
        loyalty_points: full(null),
        // A file is at most present, whatever the policy says (C233.3).
        proof: presence(true),
      },
      'related-objects': [
        {
          type: 'connect/source-data/verification/government-id',
          attributes: {
            status: full('passed'),
            'created-at': presence(true),
            country: presence(true),
            'id-class': presence(true),
            'name-first': full('Alex'),
            'name-last': presence(true),
            birthdate: presence(false),
            checks: full([
              { name: 'id_blur_detection', status: 'passed' },
              { name: 'id_selfie_comparison', status: 'passed' },
              { name: 'id_public_figure_detection', status: 'failed' },
            ]),
          },
          files: presence(true),
        },
        {
          type: 'connect/source-data/verification/selfie',
          attributes: {
            status: full('passed'),
            // A selfie's own attributes describe the face: present at most (C233.3).
            'liveness-score': presence(true),
            'center-photo-face-coordinates': presence(true),
            checks: presence(true),
          },
          files: presence(true),
        },
        {
          type: 'connect/source-data/verification/email-address',
          attributes: {
            status: presence(true),
            'created-at': presence(true),
            'email-address': presence(true),
            checks: presence(true),
          },
        },
      ],
    });
  });

  it('leaves out what the policy does not share: data, checks, files, other fields', () => {
    const policy = {
      ...verificationsWith({
        types: ['government-id'],
        'extracted-data': false,
        'check-results': false,
        files: false,
      }),
      fields: { ...EVERYTHING.fields, inquiry: ['name_first'] },
      peek: PEEK,
    };
    expect(envelopeOf(policy, inquiryContent())).toEqual({
      type: 'connect/source-data/inquiry',
      attributes: {
        status: full('approved'),
        'created-at': presence(true),
        'decisioned-at': presence(true),
      },
      fields: { name_first: full('Alex') },
      'related-objects': [
        {
          type: 'connect/source-data/verification/government-id',
          attributes: {
            status: full('passed'),
            'created-at': presence(true),
            country: presence(true),
            'id-class': presence(true),
          },
        },
      ],
    });
  });

  it('with biometric off, serves no selfie and no face-match result, and only document files', () => {
    const envelope = envelopeOf({ ...EVERYTHING, biometric: false, peek: PEEK }, inquiryContent());
    if (envelope.type !== 'connect/source-data/inquiry') throw new Error('expected an inquiry');
    expect(envelope['related-objects'].map((object) => object.type)).toEqual([
      'connect/source-data/verification/government-id',
      'connect/source-data/verification/email-address',
    ]);
    expect(envelope['related-objects'][0]?.attributes.checks).toEqual(
      full([{ name: 'id_blur_detection', status: 'passed' }]),
    );
    expect(envelope['related-objects'][0]?.files).toEqual(presence(true));
    const portraitOnly = inquiryContent([governmentId({ files: [file('p', 'portrait')] })]);
    const second = envelopeOf({ ...EVERYTHING, biometric: false }, portraitOnly);
    if (second.type !== 'connect/source-data/inquiry') throw new Error('expected an inquiry');
    expect(second['related-objects'][0]?.files).toEqual(presence(false));
  });

  it(`serves at most ${String(SOURCE_DATA_RELATED_OBJECTS_MAX)} related objects`, () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      governmentId({ id: `ver_${String(index)}` }),
    );
    const envelope = envelopeOf(EVERYTHING, inquiryContent(many));
    if (envelope.type !== 'connect/source-data/inquiry') throw new Error('expected an inquiry');
    expect(envelope['related-objects']).toHaveLength(SOURCE_DATA_RELATED_OBJECTS_MAX);
  });

  it('drops a field whose key no envelope can hold', () => {
    const content = inquiryContent([], {
      ...inquiryObject(),
      fields: [field('Name First', 'string', 'Alex'), field('name_first', 'string', 'Alex')],
    });
    const policy = policyWith({
      fields: { ...EVERYTHING.fields, inquiry: ['Name First', 'name_first'] },
    });
    const envelope = envelopeOf(policy, content);
    if (envelope.type !== 'connect/source-data/inquiry') throw new Error('expected an inquiry');
    expect(envelope.fields).toEqual({ name_first: presence(true) });
  });

  it('serves nothing for a source the policy does not share', () => {
    expect(sourceDataOf(policyWith({ 'source-types': ['account'] }), inquiryContent())).toBeNull();
  });
});

describe('the other subtypes (C233.2)', () => {
  it('serves an account and a transaction with their fields bucket', () => {
    const policy = policyWith({
      peek: { 'account.fields.name_first': 'full', 'transaction.status': 'full' },
    });
    expect(
      sourceDataOf(policy, {
        type: 'account',
        object: {
          id: 'acc_x',
          cloned: false,
          attributes: { status: 'active', 'reference-id': 'ref' },
          fields: [field('name_first', 'string', 'Alex'), field('phone_number', 'string', null)],
        },
      }),
    ).toEqual({
      type: 'connect/source-data/account',
      attributes: { status: presence(true) },
      fields: { name_first: full('Alex'), phone_number: presence(false) },
    });
    expect(
      sourceDataOf(policy, {
        type: 'transaction',
        object: {
          id: 'txn_x',
          cloned: false,
          attributes: { status: 'approved' },
          fields: [field('receipt', 'file', 'file_receipt')],
        },
      }),
    ).toEqual({
      type: 'connect/source-data/transaction',
      attributes: { status: full('approved') },
      fields: { receipt: presence(true) },
    });
  });

  it('serves a verification source alone, its files only when files are on', () => {
    const policy = policyWith({ peek: PEEK });
    expect(sourceDataOf(policy, { type: 'verification', verification: governmentId() })).toEqual({
      type: 'connect/source-data/verification/government-id',
      attributes: {
        status: full('passed'),
        'created-at': presence(true),
        country: presence(true),
        'id-class': presence(true),
        'name-first': full('Alex'),
        'name-last': presence(true),
        birthdate: presence(false),
        checks: full([
          { name: 'id_blur_detection', status: 'passed' },
          { name: 'id_selfie_comparison', status: 'passed' },
          { name: 'id_public_figure_detection', status: 'failed' },
        ]),
      },
      files: presence(true),
    });
    expect(
      sourceDataOf(
        { ...verificationsWith({ files: false }), peek: PEEK },
        { type: 'verification', verification: emailAddress({ checks: [] }) },
      ),
    ).toEqual({
      type: 'connect/source-data/verification/email-address',
      attributes: {
        status: presence(true),
        'created-at': presence(true),
        'email-address': presence(true),
        checks: presence(false),
      },
    });
  });
});

// Property tests over seeded synthetic sources --------------------------------------------------

const subset = <Item>(random: SeededRandom, items: readonly Item[]): Item[] =>
  items.filter(() => random.chance(0.5));

const SECRET = 'synthetic-secret-';

function randomVerification(random: SeededRandom, index: number): ShareVerificationEntry {
  const kind = random.pick(SHARE_VERIFICATION_KINDS);
  return {
    id: `ver_${String(index)}`,
    type: VERIFICATION_TYPE_OF_SHARE_KIND[kind],
    status: random.pick(['passed', 'failed']),
    cloned: false,
    fromRejectedHandoff: false,
    attributes: {
      'name-first': `${SECRET}name`,
      'liveness-score': 0.5,
      'center-photo-face-coordinates': [1, 2, 3, 4],
      country: 'US',
    },
    checks: [check('id_selfie_comparison'), check('selfie_liveness_detection')],
    files: SHARE_FILE_KINDS.map((kind_, at) => file(`${SECRET}file-${String(at)}`, kind_)),
  };
}

function randomContent(random: SeededRandom): ShareSourceContent {
  const object = {
    id: 'obj',
    cloned: false,
    attributes: { status: 'approved', 'created-at': '2026-10-01T00:00:00.000Z' },
    fields: [
      ...SHARE_FIELD_TYPES.map((type, at) => field(`f${String(at)}`, type, `${SECRET}${type}`)),
      field('proof', 'platform-file', `${SECRET}file-proof`),
    ],
  };
  const type = random.pick(SHARE_SOURCE_KINDS);
  if (type === 'verification') return { type, verification: randomVerification(random, 0) };
  if (type === 'inquiry') {
    return {
      type,
      object,
      verifications: Array.from({ length: random.int(0, 4) }, (_, at) =>
        randomVerification(random, at),
      ),
    };
  }
  return { type, object };
}

function randomPolicy(random: SeededRandom, withPeek: boolean): SharePolicyRules {
  const keys = [...SHARE_FIELD_TYPES.map((_, at) => `f${String(at)}`), 'proof'];
  const biometric = random.chance(0.5);
  const policy: SharePolicyRules = {
    ...EVERYTHING,
    'source-types': subset(random, SHARE_SOURCE_KINDS),
    verifications: {
      types: subset(random, SHARE_VERIFICATION_KINDS).filter((k) => biometric || k !== 'selfie'),
      'extracted-data': random.chance(0.5),
      'check-results': random.chance(0.5),
      files: random.chance(0.5),
    },
    fields: { inquiry: subset(random, keys), account: subset(random, keys), transaction: keys },
    biometric,
  };
  if (!withPeek) return policy;
  const paths = [
    ...['inquiry', 'account', 'transaction'].flatMap((subtype) => [
      `${subtype}.status`,
      ...keys.map((key) => `${subtype}.fields.${key}`),
    ]),
    ...SHARE_VERIFICATION_KINDS.flatMap((kind) =>
      ['status', 'name-first', 'checks', 'liveness-score', 'center-photo-face-coordinates'].map(
        (name) => `verification/${kind}.${name}`,
      ),
    ),
  ];
  return {
    ...policy,
    peek: Object.fromEntries(
      subset(random, paths).map((path) => [path, random.pick(['full', 'presence'] as const)]),
    ),
  };
}

/** Every `[path, attribute]` of an envelope, its paths as the policy's peek map names them. */
function attributesOf(envelope: SourceDataEnvelope): [string, PeekAttributeValue][] {
  const subtype = envelope.type.slice('connect/source-data/'.length);
  const own = Object.entries(envelope.attributes).map(
    ([name, value]): [string, PeekAttributeValue] => [`${subtype}.${name}`, value],
  );
  if (!('fields' in envelope)) return own;
  const fields = Object.entries(envelope.fields).map(
    ([key, value]): [string, PeekAttributeValue] => [`${subtype}.fields.${key}`, value],
  );
  const related =
    'related-objects' in envelope ? envelope['related-objects'].flatMap(attributesOf) : [];
  return [...own, ...fields, ...related];
}

describe('what a peek can never serve (property tests, seeded)', () => {
  const RUNS = 1500;

  it('serves nothing but presence booleans while the policy names no full path', () => {
    const random = seededRandom(233_2);
    for (let run = 0; run < RUNS; run += 1) {
      const envelope = sourceDataOf(randomPolicy(random, false), randomContent(random));
      if (envelope === null) continue;
      for (const [path, attribute] of attributesOf(envelope)) {
        expect(attribute.visibility, `run ${String(run)} ${path}`).toBe('presence');
        expect(typeof attribute.value, `run ${String(run)} ${path}`).toBe('boolean');
      }
    }
  });

  it('serves a value only at a path the policy shares and names full, never a file or face data', () => {
    const random = seededRandom(233_3);
    for (let run = 0; run < RUNS; run += 1) {
      const policy = randomPolicy(random, true);
      const envelope = sourceDataOf(policy, randomContent(random));
      if (envelope === null) continue;
      const serialised = JSON.stringify(envelope);
      expect(serialised, `run ${String(run)}`).not.toContain(`${SECRET}file`);
      expect(serialised, `run ${String(run)}`).not.toContain(`${SECRET}platform-file`);
      for (const [path, attribute] of attributesOf(envelope)) {
        if (attribute.visibility !== 'full') continue;
        const label = `run ${String(run)} ${path}`;
        expect(policy.peek[path], label).toBe('full');
        expect(peekPathShared(policy, path), label).toBe(true);
        expect(path.startsWith('verification/selfie.') && !path.endsWith('.status'), label).toBe(
          path === 'verification/selfie.checks',
        );
      }
    }
  });
});
