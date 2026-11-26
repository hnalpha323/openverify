/**
 * C230.3, C230.4, C232.1 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 1): what a
 * share holds after the policy's filter, and the categories it carries. Tables first, then property
 * tests over seeded synthetic sources (the set relations: a narrower policy carries no more, and
 * what a flow's consent names covers every token made under the same policy).
 */
import { describe, expect, it } from 'vitest';
import { seededRandom, type SeededRandom } from '../analytics/testing/random.js';
import { SHARE_CATEGORIES, SHARE_FIELD_TYPES, type ShareFieldType } from './categories.js';
import {
  DECIDED_VERIFICATION_STATUSES,
  OBJECT_BASE_ATTRIBUTES,
  VERIFICATION_BASE_ATTRIBUTES,
  policyShareCategories,
  shareCategoriesOf,
  shareableContent,
  sourceIsCopy,
  sourceKindOf,
  sourceNotDecided,
  type ShareSourceContent,
  type ShareVerificationEntry,
  type SharedContent,
} from './content.js';
import {
  SHARE_FILE_KINDS,
  SHARE_SOURCE_KINDS,
  SHARE_VERIFICATION_KINDS,
  VERIFICATION_TYPE_OF_SHARE_KIND,
  type SharePolicyRules,
  type ShareVerificationKind,
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

const shared = (policy: SharePolicyRules, content: ShareSourceContent): SharedContent => {
  const result = shareableContent(policy, content);
  if (result === null) throw new Error('expected the policy to share the source');
  return result;
};

const inquiryOf = (result: SharedContent) => {
  if (result.type !== 'inquiry') throw new Error('expected an inquiry');
  return result;
};

describe('the base attributes and decided statuses (C233.2, C234.3)', () => {
  it('name only metadata, never a field, a note, a tag or a reference', () => {
    expect(OBJECT_BASE_ATTRIBUTES).toEqual({
      inquiry: ['status', 'created-at', 'decisioned-at'],
      account: ['status', 'created-at'],
      transaction: ['status', 'created-at'],
    });
    expect(VERIFICATION_BASE_ATTRIBUTES).toEqual(['status', 'created-at', 'country', 'id-class']);
    expect(DECIDED_VERIFICATION_STATUSES).toEqual(['passed', 'failed']);
  });
});

describe('the filter of an inquiry (C230.3, C234.3)', () => {
  it('keeps the base attributes, the allowlisted fields and the shareable verifications', () => {
    const result = inquiryOf(shared(EVERYTHING, inquiryContent()));
    expect(result.object).toEqual({
      id: 'inq_source',
      base: {
        status: 'approved',
        'created-at': '2026-10-20T10:59:00.000Z',
        'decisioned-at': '2026-10-20T11:05:00.000Z',
      },
      fields: [
        field('name_first', 'string', 'Alex'),
        field('email_address', 'email-address', 'alex@example.com'),
        field('loyalty_points', 'integer', null),
        field('proof', 'platform-file', 'file_proof'),
      ],
    });
    expect(result.verifications.map((verification) => verification.kind)).toEqual([
      'government-id',
      'selfie',
      'email-address',
    ]);
    expect(result.verifications[0]).toEqual({
      id: 'ver_gov',
      kind: 'government-id',
      status: 'passed',
      base: {
        status: 'passed',
        'created-at': '2026-10-20T11:00:00.000Z',
        country: 'US',
        'id-class': 'dl',
      },
      extracted: { 'name-first': 'Alex', 'name-last': 'Example', birthdate: null },
      checks: [
        check('id_blur_detection'),
        check('id_selfie_comparison'),
        check('id_public_figure_detection', 'failed'),
      ],
      files: [file('file_front', 'document-image'), file('file_portrait', 'portrait')],
    });
  });

  it('never carries a face template, whatever the policy says', () => {
    const result = inquiryOf(shared(EVERYTHING, inquiryContent()));
    const kinds = result.verifications.flatMap((verification) =>
      verification.files.map((entry) => entry.kind),
    );
    expect(kinds).not.toContain('face-template');
    expect(kinds).toEqual(['document-image', 'portrait', 'selfie-image']);
  });

  it('with biometric off, leaves out portraits, face matches and liveness, and every selfie', () => {
    const result = inquiryOf(shared({ ...EVERYTHING, biometric: false }, inquiryContent()));
    expect(result.verifications.map((verification) => verification.kind)).toEqual([
      'government-id',
      'email-address',
    ]);
    expect(result.verifications[0]?.checks).toEqual([check('id_blur_detection')]);
    expect(result.verifications[0]?.files).toEqual([file('file_front', 'document-image')]);
  });

  it('keeps extracted data, checks and files only when the policy turns them on', () => {
    const result = inquiryOf(
      shared(
        verificationsWith({ 'extracted-data': false, 'check-results': false, files: false }),
        inquiryContent(),
      ),
    );
    const [first] = result.verifications;
    expect(first?.extracted).toEqual({});
    expect(first?.checks).toEqual([]);
    expect(first?.files).toEqual([]);
    expect(first?.base).toEqual({
      status: 'passed',
      'created-at': '2026-10-20T11:00:00.000Z',
      country: 'US',
      'id-class': 'dl',
    });
  });

  it('shares only listed, decided, uncopied verifications that no rejected handoff made', () => {
    const content = inquiryContent([
      governmentId({ id: 'ver_listed' }),
      governmentId({ id: 'ver_submitted', status: 'submitted' }),
      governmentId({ id: 'ver_failed', status: 'failed' }),
      governmentId({ id: 'ver_review', status: 'needs_review' }),
      governmentId({ id: 'ver_clone', cloned: true }),
      governmentId({ id: 'ver_handoff', fromRejectedHandoff: true }),
      { ...governmentId({ id: 'ver_nfc' }), type: 'government_id_nfc' },
      emailAddress(),
    ]);
    const result = inquiryOf(
      shared(verificationsWith({ types: ['government-id', 'database'] }), content),
    );
    expect(result.verifications.map((verification) => verification.id)).toEqual([
      'ver_listed',
      'ver_failed',
    ]);
  });

  it('never reads a reserved attribute as extracted data', () => {
    const result = inquiryOf(
      shared(
        EVERYTHING,
        inquiryContent([
          governmentId({
            attributes: {
              'name-first': 'Alex',
              checks: ['x'],
              files: ['y'],
              fields: { z: 1 },
              status: 'failed',
            },
          }),
        ]),
      ),
    );
    // A document's extracted values are its attribute `fields`, so only checks and files are reserved.
    expect(result.verifications[0]?.extracted).toEqual({ 'name-first': 'Alex', fields: { z: 1 } });
    // The entry's own status wins over an attribute of the same name.
    expect(result.verifications[0]?.base).toEqual({ status: 'passed' });
  });

  it("carries only a type's own checks and file kinds (a check of another type is not its result)", () => {
    const result = inquiryOf(
      shared(
        EVERYTHING,
        inquiryContent([
          emailAddress({
            checks: [check('email_address_otp_comparison'), check('id_selfie_comparison')],
            files: [file('f1', 'document-image'), file('f2', 'portrait')],
          }),
          selfie({ files: [file('f3', 'selfie-image'), file('f4', 'portrait')] }),
          governmentId({ checks: [check('not_a_check')], files: [file('f5', 'selfie-image')] }),
        ]),
      ),
    );
    expect(result.verifications.map(({ checks }) => checks)).toEqual([
      [check('email_address_otp_comparison')],
      [check('selfie_liveness_detection'), check('selfie_id_comparison')],
      [],
    ]);
    expect(result.verifications.map(({ files }) => files)).toEqual([
      [],
      [file('f3', 'selfie-image')],
      [],
    ]);
  });

  it('shares no inquiry under a policy without the inquiry source type', () => {
    expect(
      shareableContent(policyWith({ 'source-types': ['account'] }), inquiryContent()),
    ).toBeNull();
  });
});

describe('the filter of the other sources (C230.3)', () => {
  it('filters an account by its own allowlist and base attributes', () => {
    const content: ShareSourceContent = {
      type: 'account',
      object: {
        id: 'acc_source',
        cloned: false,
        attributes: { status: 'active', 'created-at': '2026-10-01T00:00:00.000Z', tags: ['x'] },
        fields: [field('name_first', 'string', 'Alex'), field('email_address', 'string', 'x')],
      },
    };
    expect(shareableContent(EVERYTHING, content)).toEqual({
      type: 'account',
      object: {
        id: 'acc_source',
        base: { status: 'active', 'created-at': '2026-10-01T00:00:00.000Z' },
        fields: [field('name_first', 'string', 'Alex')],
      },
    });
    expect(shareableContent(policyWith({ 'source-types': ['inquiry'] }), content)).toBeNull();
  });

  it('filters a transaction by its allowlist', () => {
    const content: ShareSourceContent = {
      type: 'transaction',
      object: {
        id: 'txn_source',
        cloned: false,
        attributes: { status: 'approved', 'created-at': '2026-10-01T00:00:00.000Z' },
        fields: [field('amount', 'number', 12.5), field('card_last4', 'string', '4242')],
      },
    };
    expect(shareableContent(EVERYTHING, content)).toEqual({
      type: 'transaction',
      object: {
        id: 'txn_source',
        base: { status: 'approved', 'created-at': '2026-10-01T00:00:00.000Z' },
        fields: [field('amount', 'number', 12.5)],
      },
    });
  });

  it('filters a verification source, or shares none the policy does not list', () => {
    const content: ShareSourceContent = { type: 'verification', verification: selfie() };
    expect(shareableContent(EVERYTHING, content)).toEqual({
      type: 'verification',
      verification: {
        id: 'ver_selfie',
        kind: 'selfie',
        status: 'passed',
        base: { status: 'passed', 'created-at': '2026-10-20T11:01:00.000Z' },
        extracted: {},
        checks: [check('selfie_liveness_detection'), check('selfie_id_comparison')],
        files: [file('file_selfie', 'selfie-image')],
      },
    });
    expect(shareableContent({ ...EVERYTHING, biometric: false }, content)).toBeNull();
    expect(shareableContent(verificationsWith({ types: ['database'] }), content)).toBeNull();
    expect(
      shareableContent(policyWith({ 'source-types': ['inquiry'] }), {
        type: 'verification',
        verification: governmentId(),
      }),
    ).toBeNull();
  });

  it('answers the source type of a content', () => {
    expect(sourceKindOf(inquiryContent())).toBe('inquiry');
    expect(sourceKindOf({ type: 'verification', verification: selfie() })).toBe('verification');
  });
});

describe('a copy and an undecided source (C232.1: source_is_copy, source_not_decided)', () => {
  it.each([
    [inquiryContent(), false],
    [inquiryContent([], inquiryObject({ cloned: true })), true],
    [inquiryContent([governmentId(), selfie({ cloned: true })]), true],
    [inquiryContent([governmentId({ cloned: true, status: 'submitted' })]), true],
    [{ type: 'verification', verification: governmentId({ cloned: true }) }, true],
    [{ type: 'verification', verification: governmentId() }, false],
    [{ type: 'account', object: inquiryObject({ id: 'acc_x' }) }, false],
  ] as [ShareSourceContent, boolean][])('case %# is a copy: %s', (content, copy) => {
    expect(sourceIsCopy(content)).toBe(copy);
  });

  it.each([
    ['passed', false],
    ['failed', false],
    ['submitted', true],
    ['initiated', true],
    ['needs_review', true],
    ['canceled', true],
  ])('a verification source %s is undecided: %s', (status, undecided) => {
    expect(sourceNotDecided({ type: 'verification', verification: governmentId({ status }) })).toBe(
      undecided,
    );
  });

  it('asks no decision of an inquiry, an account or a transaction', () => {
    expect(sourceNotDecided(inquiryContent([governmentId({ status: 'submitted' })]))).toBe(false);
    expect(sourceNotDecided({ type: 'account', object: inquiryObject() })).toBe(false);
  });
});

describe('the categories a share carries (C230.4)', () => {
  it('classes every part of an inquiry share, in the closed order', () => {
    expect(shareCategoriesOf(shared(EVERYTHING, inquiryContent()))).toEqual([
      'identity-fields',
      'contact-fields',
      'document-images',
      'biometric',
      'check-results',
    ]);
  });

  it('carries no category for a field the source holds no value in', () => {
    const content = inquiryContent([], {
      ...inquiryObject(),
      attributes: {},
      fields: [field('loyalty_points', 'integer', null), field('nickname', 'string', undefined)],
    });
    expect(shareCategoriesOf(shared(EVERYTHING, content))).toEqual([]);
  });

  it('classes fields by their well-known key, else their type', () => {
    const content = inquiryContent([], {
      ...inquiryObject(),
      attributes: {},
      fields: [
        field('loyalty_points', 'integer', 3),
        field('email_address', 'string', 'alex@example.com'),
        field('proof', 'file', 'file_x'),
      ],
    });
    expect(shareCategoriesOf(shared(EVERYTHING, content))).toEqual([
      'contact-fields',
      'other-fields',
      'document-images',
    ]);
  });

  it("classes an inquiry's status, and a verification's, as a result", () => {
    const content = inquiryContent([], { ...inquiryObject(), fields: [] });
    expect(shareCategoriesOf(shared(EVERYTHING, content))).toEqual(['check-results']);
    const verification: ShareVerificationEntry = {
      ...emailAddress(),
      attributes: {},
      checks: [],
    };
    expect(shareCategoriesOf(shared(EVERYTHING, { type: 'verification', verification }))).toEqual([
      'check-results',
    ]);
  });

  it('classes a selfie as biometric whatever it holds', () => {
    const bare = selfie({ attributes: {}, checks: [], files: [] });
    expect(
      shareCategoriesOf(shared(EVERYTHING, { type: 'verification', verification: bare })),
    ).toEqual(['biometric', 'check-results']);
  });

  it('carries no biometric category with biometric off, nor an account any result', () => {
    expect(
      shareCategoriesOf(shared({ ...EVERYTHING, biometric: false }, inquiryContent())),
    ).toEqual(['identity-fields', 'contact-fields', 'document-images', 'check-results']);
    const account: ShareSourceContent = {
      type: 'account',
      object: {
        id: 'acc_x',
        cloned: false,
        attributes: { status: 'active' },
        fields: [field('phone_number', 'string', '+15555550100')],
      },
    };
    expect(shareCategoriesOf(shared(EVERYTHING, account))).toEqual(['contact-fields']);
  });

  it('classes an identity document’s country and class, and extracted keys', () => {
    const gov = governmentId({
      attributes: { country: 'US', 'phone-number': '+15555550100', 'favourite-colour': 'x' },
      checks: [],
      files: [],
    });
    expect(
      shareCategoriesOf(shared(EVERYTHING, { type: 'verification', verification: gov })),
    ).toEqual(['identity-fields', 'contact-fields', 'check-results']);
  });
});

describe('the categories a policy can carry (C230.4, C238.3)', () => {
  it.each([
    [
      'an inquiry under every part',
      EVERYTHING,
      'inquiry',
      [
        'identity-fields',
        'contact-fields',
        'other-fields',
        'document-images',
        'biometric',
        'check-results',
      ],
    ],
    [
      'an inquiry with biometric off',
      { ...verificationsWith({ types: ['government-id', 'database'] }), biometric: false },
      'inquiry',
      ['identity-fields', 'contact-fields', 'other-fields', 'document-images', 'check-results'],
    ],
    ['an account', EVERYTHING, 'account', ['identity-fields', 'contact-fields']],
    ['a transaction', EVERYTHING, 'transaction', ['other-fields', 'document-images']],
    [
      'an email verification, results only',
      verificationsWith({
        types: ['email-address'],
        'extracted-data': false,
        files: false,
      }),
      'verification',
      ['check-results'],
    ],
    [
      'an email verification with its data',
      verificationsWith({ types: ['email-address'], files: false }),
      'verification',
      ['contact-fields', 'check-results'],
    ],
    [
      'a database verification with its data (it holds no file)',
      verificationsWith({ types: ['database'] }),
      'verification',
      ['identity-fields', 'contact-fields', 'check-results'],
    ],
    [
      'a government ID with files but without biometric (its country and class are identity)',
      {
        ...verificationsWith({ types: ['government-id'], 'extracted-data': false }),
        biometric: false,
      },
      'verification',
      ['identity-fields', 'document-images', 'check-results'],
    ],
    [
      'a government ID with biometric, no files',
      verificationsWith({ types: ['government-id'], files: false, 'extracted-data': false }),
      'verification',
      ['identity-fields', 'biometric', 'check-results'],
    ],
    [
      'a source type the policy does not share',
      policyWith({ 'source-types': ['inquiry'] }),
      'account',
      [],
    ],
  ] as const)('%s', (_name, policy, sourceType, expected) => {
    expect(
      policyShareCategories(policy, sourceType, {
        loyalty_points: 'integer',
        proof: 'platform-file',
        amount: 'number',
        receipt: 'file',
      }),
    ).toEqual(expected);
  });
});

// Property tests over seeded synthetic sources --------------------------------------------------

const VERIFICATION_STATUSES = ['passed', 'failed', 'submitted', 'needs_review'];
const CHECK_NAMES = [
  'id_blur_detection',
  'id_selfie_comparison',
  'id_public_figure_detection',
  'selfie_liveness_detection',
  'database_name_comparison',
  'email_address_otp_comparison',
];
const FIELD_KEYS = ['name_first', 'email_address', 'loyalty_points', 'proof', 'nickname', 'x'];
/** Each type's attributes as its resource names them (`verification-attributes.ts`). */
const KIND_ATTRIBUTES: Readonly<Record<ShareVerificationKind, readonly string[]>> = {
  'government-id': ['name-first', 'birthdate', 'address-city', 'country', 'id-class'],
  selfie: ['liveness-score', 'capture-method'],
  database: ['name-first', 'phone-number', 'email-address'],
  document: ['fields', 'document-type'],
  'email-address': ['email-address', 'sends'],
  'phone-number': ['phone-number', 'failed-attempts'],
};

const subset = <Item>(random: SeededRandom, items: readonly Item[]): Item[] =>
  items.filter(() => random.chance(0.5));

function randomVerification(random: SeededRandom, index: number): ShareVerificationEntry {
  const kind = random.pick(SHARE_VERIFICATION_KINDS);
  return {
    id: `ver_${String(index)}`,
    type: random.chance(0.9) ? VERIFICATION_TYPE_OF_SHARE_KIND[kind] : 'aamva',
    status: random.pick(VERIFICATION_STATUSES),
    cloned: random.chance(0.1),
    fromRejectedHandoff: random.chance(0.1),
    attributes: Object.fromEntries(
      subset(random, KIND_ATTRIBUTES[kind]).map((key) => [key, random.chance(0.8) ? 'x' : null]),
    ),
    checks: subset(random, CHECK_NAMES).map((name) => check(name)),
    files: subset(random, SHARE_FILE_KINDS).map((kind_, at) => file(`f${String(at)}`, kind_)),
  };
}

function randomFieldTypes(random: SeededRandom): Record<string, ShareFieldType> {
  return Object.fromEntries(FIELD_KEYS.map((key) => [key, random.pick(SHARE_FIELD_TYPES)]));
}

function randomContent(
  random: SeededRandom,
  fieldTypes: Readonly<Record<string, ShareFieldType>>,
): ShareSourceContent {
  const object = {
    id: 'obj',
    cloned: false,
    attributes: { status: random.pick(['approved', 'declined', null]) },
    fields: subset(random, FIELD_KEYS).map((key) =>
      field(key, fieldTypes[key] ?? 'string', random.chance(0.8) ? 'v' : null),
    ),
  };
  const type = random.pick(SHARE_SOURCE_KINDS);
  if (type === 'verification') {
    return { type, verification: randomVerification(random, 0) };
  }
  if (type === 'inquiry') {
    return {
      type,
      object,
      verifications: Array.from({ length: random.int(0, 5) }, (_, index) =>
        randomVerification(random, index),
      ),
    };
  }
  return { type, object };
}

function randomPolicy(random: SeededRandom): SharePolicyRules {
  const biometric = random.chance(0.5);
  const types = subset(random, SHARE_VERIFICATION_KINDS).filter(
    (kind) => biometric || kind !== 'selfie',
  );
  return {
    ...EVERYTHING,
    'source-types': subset(random, SHARE_SOURCE_KINDS),
    verifications: {
      types,
      'extracted-data': random.chance(0.5),
      'check-results': random.chance(0.5),
      files: random.chance(0.5),
    },
    fields: {
      inquiry: subset(random, FIELD_KEYS),
      account: subset(random, FIELD_KEYS),
      transaction: subset(random, FIELD_KEYS),
    },
    biometric,
  };
}

/** `wide` with some of its permissions taken away. */
function narrowed(random: SeededRandom, wide: SharePolicyRules): SharePolicyRules {
  return {
    ...wide,
    'source-types': wide['source-types'].filter(() => random.chance(0.8)),
    verifications: {
      types: wide.verifications.types.filter(() => random.chance(0.8)),
      'extracted-data': wide.verifications['extracted-data'] && random.chance(0.8),
      'check-results': wide.verifications['check-results'] && random.chance(0.8),
      files: wide.verifications.files && random.chance(0.8),
    },
    fields: {
      inquiry: wide.fields.inquiry.filter(() => random.chance(0.8)),
      account: wide.fields.account.filter(() => random.chance(0.8)),
      transaction: wide.fields.transaction.filter(() => random.chance(0.8)),
    },
    biometric: wide.biometric && random.chance(0.8),
  };
}

const categoriesUnder = (policy: SharePolicyRules, content: ShareSourceContent) => {
  const result = shareableContent(policy, content);
  return result === null ? null : shareCategoriesOf(result);
};

describe('the set relations of categories (property tests, seeded)', () => {
  const RUNS = 2000;

  it('a narrower policy never carries a category the wider one does not', () => {
    const random = seededRandom(230_4);
    for (let run = 0; run < RUNS; run += 1) {
      const fieldTypes = randomFieldTypes(random);
      const content = randomContent(random, fieldTypes);
      const wide = randomPolicy(random);
      const narrow = narrowed(random, wide);
      const wideCategories = categoriesUnder(wide, content);
      const narrowCategories = categoriesUnder(narrow, content);
      if (narrowCategories === null) continue;
      expect(wideCategories, `run ${String(run)}`).not.toBeNull();
      for (const category of narrowCategories) {
        expect(wideCategories, `run ${String(run)}`).toContain(category);
      }
    }
  });

  it("what a policy can carry covers every share made under it (a flow consent's categories)", () => {
    const random = seededRandom(238_3);
    for (let run = 0; run < RUNS; run += 1) {
      const fieldTypes = randomFieldTypes(random);
      const content = randomContent(random, fieldTypes);
      const policy = randomPolicy(random);
      const carried = categoriesUnder(policy, content);
      if (carried === null) continue;
      const possible = policyShareCategories(policy, content.type, fieldTypes);
      for (const category of carried) {
        expect(possible, `run ${String(run)}`).toContain(category);
      }
    }
  });

  it('carries no biometric category without biometric, and is always ordered and distinct', () => {
    const random = seededRandom(230_3);
    for (let run = 0; run < RUNS; run += 1) {
      const fieldTypes = randomFieldTypes(random);
      const content = randomContent(random, fieldTypes);
      const policy = randomPolicy(random);
      const carried = categoriesUnder(policy, content) ?? [];
      if (!policy.biometric) {
        expect(carried, `run ${String(run)}`).not.toContain('biometric');
      }
      const ordered = SHARE_CATEGORIES.filter((category) => carried.includes(category));
      expect(carried, `run ${String(run)}`).toEqual(ordered);
    }
  });
});
