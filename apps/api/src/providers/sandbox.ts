/**
 * The deterministic sandbox providers of the A-tier checks (C35, C44, ADR 0002 §3d): the same
 * request always gives the same answer, chosen by documented magic values, so tests and demos can
 * reach every outcome. Every result is labelled `{ id: "sandbox", sandbox: true }`, and
 * configuration never binds them to production. The magic values, listed in
 * `docs/checks/sandbox-providers.md`, are:
 * - government ID checks and the AAMVA verification (C59.4): the last four characters of the
 *   identification number (upper case, `A-Z0-9` only);
 * - selfie checks: a token in the inquiry's `reference-id` (`SANDBOX_SELFIE_MAGIC`).
 */
import { ageOn, parseIsoDate, utcToday, type AamvaLookupResult } from '@openverify/checks';
import type { ExtractedFields } from '@openverify/core';
import {
  systemClock,
  type AamvaLookupProvider,
  type AgeEstimateProvider,
  type Clock,
  type PublicFigureProvider,
  type SandboxSelfieAgeEstimateProvider,
  type SandboxSelfiePublicFigureProvider,
  type SandboxSuspiciousEntityProvider,
} from '../ports.js';

export const SANDBOX_PROVIDER_ID = 'sandbox';

/** The magic number endings and the fixed answers of the sandbox providers. */
export const SANDBOX_MAGIC = Object.freeze({
  aamva: Object.freeze({
    noMatch: '0000',
    nameMismatch: '0001',
    postalCodeMismatch: '0002',
    notParticipating: '5555',
    notFound: '9999',
  }),
  publicFigure: Object.freeze({ match: '7777', galleryEmpty: '4040' }),
  ageEstimate: Object.freeze({
    inconsistent: '8888',
    offsetYears: 25,
    withoutBirthdate: 30,
    confidence: 0.9,
  }),
});

/** The last four characters of the identification number, as the magic values are written. */
function ending(fields: ExtractedFields): string | null {
  const number = fields['identification-number']?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
  return number === '' ? null : number.slice(-4);
}

/** The DLDV answer of each magic ending (C35, C59.4); any other ending is a match. */
const AAMVA_ANSWERS: ReadonlyMap<string, AamvaLookupResult> = new Map<string, AamvaLookupResult>([
  [
    SANDBOX_MAGIC.aamva.noMatch,
    { outcome: 'no_match', mismatchedFields: ['name-last', 'birthdate'] },
  ],
  [SANDBOX_MAGIC.aamva.nameMismatch, { outcome: 'no_match', mismatchedFields: ['name-last'] }],
  [
    SANDBOX_MAGIC.aamva.postalCodeMismatch,
    { outcome: 'no_match', mismatchedFields: ['address-postal-code'] },
  ],
  [SANDBOX_MAGIC.aamva.notParticipating, { outcome: 'jurisdiction_not_participating' }],
  [SANDBOX_MAGIC.aamva.notFound, { outcome: 'not_found' }],
]);

/**
 * AAMVA DLDV: `0000` no match (name and birth date), `0001` the name only, `0002` the postal code
 * only, `5555` a jurisdiction outside DLDV, `9999` no record (none without a number), anything
 * else a match. The government ID check and the AAMVA verification read the same endings.
 */
export function createSandboxAamvaProvider(): AamvaLookupProvider {
  return {
    id: SANDBOX_PROVIDER_ID,
    sandbox: true,
    lookup: ({ fields }) => {
      const last = ending(fields);
      if (last === null) {
        return Promise.resolve({ outcome: 'not_found' });
      }
      const answer = AAMVA_ANSWERS.get(last) ?? { outcome: 'match' as const };
      return Promise.resolve({
        ...answer,
        ...(answer.mismatchedFields === undefined
          ? {}
          : { mismatchedFields: [...answer.mismatchedFields] }),
      });
    },
  };
}

/** Public figures: `7777` a match, `4040` an empty gallery, anything else no match. */
export function createSandboxPublicFigureProvider(): PublicFigureProvider {
  return {
    id: SANDBOX_PROVIDER_ID,
    sandbox: true,
    match: ({ fields }) => {
      const last = ending(fields);
      return Promise.resolve({
        outcome:
          last === SANDBOX_MAGIC.publicFigure.match
            ? 'match'
            : last === SANDBOX_MAGIC.publicFigure.galleryEmpty
              ? 'gallery_empty'
              : 'no_match',
      });
    },
  };
}

/**
 * Apparent age: the age the birth date gives on the clock's day (30 without a readable one),
 * 25 years more for `8888`, always with confidence 0.9. It looks at no image.
 */
export function createSandboxAgeEstimateProvider(
  options: { clock?: Clock | undefined } = {},
): AgeEstimateProvider {
  const clock = options.clock ?? systemClock;
  const magic = SANDBOX_MAGIC.ageEstimate;
  return {
    id: SANDBOX_PROVIDER_ID,
    sandbox: true,
    estimate: ({ fields }) => {
      const birth = fields.birthdate === null ? null : parseIsoDate(fields.birthdate);
      const age = birth === null ? magic.withoutBirthdate : ageOn(birth, utcToday(clock.now()));
      const offset = ending(fields) === magic.inconsistent ? magic.offsetYears : 0;
      return Promise.resolve({ estimatedAge: age + offset, confidence: magic.confidence });
    },
  };
}

// C44: the selfie sandbox providers -------------------------------------------------------------

/**
 * The selfie magic values: tokens in the inquiry's `reference-id` (lower-cased first). When
 * several are present, the first in precedence order (public figure, suspicious entity, age)
 * decides, and the other providers give their ordinary answer.
 */
export const SANDBOX_SELFIE_MAGIC = Object.freeze({
  publicFigure: /(?:^|[^a-z0-9])sandbox-public-figure(?![a-z0-9-])/,
  suspiciousEntity: /(?:^|[^a-z0-9])sandbox-suspicious-entity(?![a-z0-9-])/,
  age: /(?:^|[^a-z0-9])sandbox-age-(\d{1,3})(?![0-9])/,
  maxAge: 150,
  /** The age without a magic age and without the compared ID's birthdate. */
  withoutBirthdate: 30,
  matchScore: 0.97,
  noMatchScore: 0.03,
});

/** Which magic token decides, by precedence; `null` when none is present. */
type SelfieMagic =
  { kind: 'public_figure' } | { kind: 'suspicious_entity' } | { kind: 'age'; age: number };

function selfieMagicOf(referenceId: string | null): SelfieMagic | null {
  const reference = referenceId?.toLowerCase() ?? '';
  if (SANDBOX_SELFIE_MAGIC.publicFigure.test(reference)) {
    return { kind: 'public_figure' };
  }
  if (SANDBOX_SELFIE_MAGIC.suspiciousEntity.test(reference)) {
    return { kind: 'suspicious_entity' };
  }
  const age = SANDBOX_SELFIE_MAGIC.age.exec(reference)?.[1];
  const years = age === undefined ? Number.NaN : Number.parseInt(age, 10);
  return Number.isInteger(years) && years <= SANDBOX_SELFIE_MAGIC.maxAge
    ? { kind: 'age', age: years }
    : null;
}

/** `selfie_public_figure_detection`: `sandbox-public-figure` matches. It looks at no image. */
export function createSandboxSelfiePublicFigureProvider(): SandboxSelfiePublicFigureProvider {
  return {
    id: SANDBOX_PROVIDER_ID,
    sandbox: true,
    matchPublicFigure: (_request, { referenceId }) => {
      const match = selfieMagicOf(referenceId)?.kind === 'public_figure';
      return Promise.resolve({
        match,
        score: match ? SANDBOX_SELFIE_MAGIC.matchScore : SANDBOX_SELFIE_MAGIC.noMatchScore,
      });
    },
  };
}

/** `selfie_suspicious_entity_detection`: `sandbox-suspicious-entity` is flagged. No image read. */
export function createSandboxSuspiciousEntityProvider(): SandboxSuspiciousEntityProvider {
  return {
    id: SANDBOX_PROVIDER_ID,
    sandbox: true,
    assess: (_request, { referenceId }) => {
      const flagged = selfieMagicOf(referenceId)?.kind === 'suspicious_entity';
      return Promise.resolve({
        flagged,
        score: flagged ? SANDBOX_SELFIE_MAGIC.matchScore : SANDBOX_SELFIE_MAGIC.noMatchScore,
      });
    },
  };
}

/**
 * `selfie_age_comparison`: `sandbox-age-<n>` (0-150) answers `n`; otherwise the age the compared
 * ID's birthdate gives on the clock's day, or 30 without a readable one. No image is read.
 */
export function createSandboxSelfieAgeEstimateProvider(
  options: { clock?: Clock | undefined } = {},
): SandboxSelfieAgeEstimateProvider {
  const clock = options.clock ?? systemClock;
  return {
    id: SANDBOX_PROVIDER_ID,
    sandbox: true,
    estimateAge: (_request, { referenceId, birthdate }) => {
      const magic = selfieMagicOf(referenceId);
      if (magic?.kind === 'age') {
        return Promise.resolve({ age: magic.age });
      }
      const birth = birthdate === null ? null : parseIsoDate(birthdate);
      return Promise.resolve({
        age:
          birth === null
            ? SANDBOX_SELFIE_MAGIC.withoutBirthdate
            : ageOn(birth, utcToday(clock.now())),
      });
    },
  };
}
