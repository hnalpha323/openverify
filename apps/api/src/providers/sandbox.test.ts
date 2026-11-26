/**
 * C35 sandbox providers: deterministic, labelled sandbox, every outcome reachable through the
 * documented magic values (the last four characters of the identification number). Synthetic
 * Utopia holders only.
 */
import { emptyExtractedFields, type ExtractedFields } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  SANDBOX_MAGIC,
  SANDBOX_SELFIE_MAGIC,
  createSandboxAamvaProvider,
  createSandboxAgeEstimateProvider,
  createSandboxPublicFigureProvider,
  createSandboxSelfieAgeEstimateProvider,
  createSandboxSelfiePublicFigureProvider,
  createSandboxSuspiciousEntityProvider,
} from './sandbox.js';

const NOW = new Date('2026-10-21T12:00:00.000Z');

const fields = (change: Partial<ExtractedFields>): ExtractedFields => ({
  ...emptyExtractedFields(),
  'name-first': 'NORA',
  'name-last': 'CALDERWOOD',
  birthdate: '1988-03-21',
  'identification-number': 'UT4829163',
  ...change,
});

const portrait = { bbox: [10, 10, 100, 120] as const, score: 0.98, embedding: [0.1, 0.2] };
const front = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' as const };

describe('the sandbox AAMVA DLDV provider', () => {
  const provider = createSandboxAamvaProvider();

  it('is labelled sandbox', () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
    // C59.4 adds 0001, 0002 and 5555 to the C35 endings.
    expect(SANDBOX_MAGIC.aamva).toEqual({
      noMatch: '0000',
      nameMismatch: '0001',
      postalCodeMismatch: '0002',
      notParticipating: '5555',
      notFound: '9999',
    });
  });

  it.each([
    [
      'a number ending in 0000',
      'D1230000',
      { outcome: 'no_match', mismatchedFields: ['name-last', 'birthdate'] },
    ],
    [
      'a number ending in 0001: the name only',
      'D1230001',
      { outcome: 'no_match', mismatchedFields: ['name-last'] },
    ],
    [
      'a number ending in 0002: the postal code only',
      'D1230002',
      { outcome: 'no_match', mismatchedFields: ['address-postal-code'] },
    ],
    [
      'a number ending in 5555: a jurisdiction outside DLDV',
      'D123-5555',
      { outcome: 'jurisdiction_not_participating' },
    ],
    ['a number ending in 9999, separators ignored', 'd123-9999', { outcome: 'not_found' }],
    ['any other number', 'D1234567', { outcome: 'match' }],
    ['no number', null, { outcome: 'not_found' }],
  ] as const)('answers %s', async (_label, number, expected) => {
    expect(
      await provider.lookup({
        jurisdiction: 'CA',
        fields: fields({ 'identification-number': number }),
      }),
    ).toEqual(expected);
  });

  it('answers the same request the same way every time', async () => {
    const request = { jurisdiction: null, fields: fields({}) };
    expect(await provider.lookup(request)).toEqual(await provider.lookup(request));
  });
});

describe('the sandbox public-figure provider', () => {
  const provider = createSandboxPublicFigureProvider();

  it.each([
    ['a number ending in 7777', 'UT4827777', { outcome: 'match' }],
    ['a number ending in 4040', 'UT4824040', { outcome: 'gallery_empty' }],
    ['any other number', 'UT4829163', { outcome: 'no_match' }],
    ['no number', null, { outcome: 'no_match' }],
  ] as const)('answers %s', async (_label, number, expected) => {
    expect(
      await provider.match({ portrait, fields: fields({ 'identification-number': number }) }),
    ).toEqual(expected);
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
  });
});

describe('the sandbox age-estimate provider', () => {
  const provider = createSandboxAgeEstimateProvider({ clock: { now: () => NOW } });

  it('estimates the age the birth date gives, with its fixed confidence', async () => {
    expect(await provider.estimate({ front, portrait, fields: fields({}) })).toEqual({
      estimatedAge: 38,
      confidence: 0.9,
    });
  });

  it('estimates 25 years more for a number ending in 8888', async () => {
    expect(
      await provider.estimate({
        front,
        portrait,
        fields: fields({ 'identification-number': 'UT4828888' }),
      }),
    ).toEqual({ estimatedAge: 63, confidence: 0.9 });
  });

  it('estimates 30 without a readable birth date', async () => {
    expect(
      await provider.estimate({ front, portrait, fields: fields({ birthdate: null }) }),
    ).toEqual({ estimatedAge: 30, confidence: 0.9 });
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
  });
});

// C44: the selfie sandbox providers, deterministic on the inquiry's reference-id ---------------

/** The centre image: the request never carries anything else (C44 minimisation). */
const centre = { image: front };
const context = (referenceId: string | null, birthdate: string | null = '1988-03-21') => ({
  referenceId,
  birthdate,
});

describe('the sandbox selfie public-figure provider (C44)', () => {
  const provider = createSandboxSelfiePublicFigureProvider();

  it('is labelled sandbox', () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
  });

  it.each([
    ['the whole token', 'sandbox-public-figure'],
    ['the token after other text', 'customer-42 sandbox-public-figure'],
    ['the token in upper case', 'SANDBOX-PUBLIC-FIGURE'],
    [
      'the token beside the others, which it outranks',
      'sandbox-suspicious-entity:sandbox-public-figure sandbox-age-12',
    ],
  ])('matches on %s', async (_label, referenceId) => {
    expect(await provider.matchPublicFigure(centre, context(referenceId))).toEqual({
      match: true,
      score: SANDBOX_SELFIE_MAGIC.matchScore,
    });
  });

  it.each([
    ['no reference id', null],
    ['an ordinary reference id', 'customer-42'],
    ['the token inside a longer word', 'xsandbox-public-figure'],
    ['the token continued', 'sandbox-public-figures'],
    ['the token followed by a hyphen', 'sandbox-public-figure-2'],
  ])('does not match %s', async (_label, referenceId) => {
    expect(await provider.matchPublicFigure(centre, context(referenceId))).toEqual({
      match: false,
      score: SANDBOX_SELFIE_MAGIC.noMatchScore,
    });
  });
});

describe('the sandbox suspicious-entity provider (C44)', () => {
  const provider = createSandboxSuspiciousEntityProvider();

  it('is labelled sandbox', () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
  });

  it('flags sandbox-suspicious-entity, outranking an age token', async () => {
    expect(
      await provider.assess(centre, context('sandbox-age-20 sandbox-suspicious-entity')),
    ).toEqual({ flagged: true, score: SANDBOX_SELFIE_MAGIC.matchScore });
  });

  it.each([
    ['no reference id', null],
    ['an ordinary reference id', 'customer-42'],
    ['a public figure, which outranks it', 'sandbox-suspicious-entity sandbox-public-figure'],
    ['the token inside a longer word', 'nosandbox-suspicious-entity'],
  ])('does not flag %s', async (_label, referenceId) => {
    expect(await provider.assess(centre, context(referenceId))).toEqual({
      flagged: false,
      score: SANDBOX_SELFIE_MAGIC.noMatchScore,
    });
  });
});

describe('the sandbox selfie age-estimate provider (C44)', () => {
  const provider = createSandboxSelfieAgeEstimateProvider({ clock: { now: () => NOW } });

  it('is labelled sandbox', () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
  });

  it.each([
    ['sandbox-age-0', 0],
    ['sandbox-age-17', 17],
    ['customer_7:sandbox-age-150', 150],
    ['SANDBOX-AGE-64', 64],
  ])('answers the magic age of %s', async (referenceId, age) => {
    expect(await provider.estimateAge(centre, context(referenceId))).toEqual({ age });
  });

  it.each([
    ['no reference id', null],
    ['an age above 150', 'sandbox-age-151'],
    ['four digits', 'sandbox-age-1234'],
    ['the token inside a longer word', 'xsandbox-age-20'],
    ['a public figure, which outranks it', 'sandbox-age-20 sandbox-public-figure'],
    ['a suspicious entity, which outranks it', 'sandbox-suspicious-entity sandbox-age-20'],
  ])('answers the birthdate age with %s', async (_label, referenceId) => {
    expect(await provider.estimateAge(centre, context(referenceId))).toEqual({ age: 38 });
  });

  it('answers 30 without a magic age or a readable birthdate', async () => {
    expect(await provider.estimateAge(centre, context(null, null))).toEqual({
      age: SANDBOX_SELFIE_MAGIC.withoutBirthdate,
    });
    expect(await provider.estimateAge(centre, context('customer-1', '1988-02-30'))).toEqual({
      age: 30,
    });
  });

  it('looks at no image: the same reference id gives the same answer for any bytes', async () => {
    const other = { image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' as const } };
    expect(await provider.estimateAge(other, context('sandbox-age-41'))).toEqual({ age: 41 });
  });
});
