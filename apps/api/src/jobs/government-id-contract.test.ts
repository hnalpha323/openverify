/**
 * The §4.1 evaluators (`@openverify/checks`), the results the worker writes itself (`execution-
 * errors.ts`, the Phase 1 unreadable path) and the shared vocabulary (`@openverify/contracts`)
 * must agree (C29.2, C29.4):
 * - every result emits only reason codes listed in `GOVERNMENT_ID_CHECK_REASONS` for its check;
 * - every result carries its registry stage, its provenance (implementation version and the
 *   thresholds it was judged against) and, for an H-tier `passed` or `failed`, a confidence.
 *
 * The inputs cover each evaluator's paths: the recorded C32 golden card and barcode fixture, in
 * a sandbox and in production, degraded and tampered analyses, missing OCR, every provider
 * outcome, matching and differing history, references and selfies. Synthetic data only.
 */
import {
  GOVERNMENT_ID_EVALUATED_CHECKS,
  evaluateGovernmentIdChecks,
  extractGovernmentId,
  unreadableImageChecks,
  type GovernmentIdCheckInput,
  type GovernmentIdProviders,
} from '@openverify/checks';
import {
  GOVERNMENT_ID_CHECK_IDS,
  GOVERNMENT_ID_CHECK_REASONS,
  type GovernmentIdCheckId,
} from '@openverify/contracts';
import {
  CHECK_REGISTRY,
  checkResultSchema,
  getCheckDefinition,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import type { GovernmentIdAnalysis } from '../ports.js';
import { executionError, visionFailureChecks } from './execution-errors.js';
import { REEMBEDDING_CHECKS } from './government-id.js';
import { MODEL_DIGESTS, governmentIdModels } from './models.js';
import { governmentIdFixture, visionFixture } from './testing.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const PROVIDER = { id: 'sandbox', sandbox: true } as const;

/** Every government ID check enabled, required, with a configured repeat distance and age limit. */
const ALL: VerificationTemplateConfig = {
  checks: Object.fromEntries(
    GOVERNMENT_ID_EVALUATED_CHECKS.map((id) => [
      id,
      {
        enabled: true,
        required: true,
        ...(id === 'id_repeat_detection' ? { config: { 'max-phash-distance': 7 } } : {}),
        ...(id === 'id_age_comparison' ? { config: { 'min-age': 18, 'max-age': 30 } } : {}),
      },
    ]),
  ),
};

const golden = (): GovernmentIdAnalysis => governmentIdFixture();
const barcodeCard = (): GovernmentIdAnalysis =>
  visionFixture('analyze-government-id-barcode' as 'analyze-government-id') as GovernmentIdAnalysis;

function changed(change: (analysis: GovernmentIdAnalysis) => void): GovernmentIdAnalysis {
  const analysis = golden();
  change(analysis);
  return analysis;
}

const back = (analysis: GovernmentIdAnalysis) => {
  if (analysis.sides.back === null) {
    throw new Error('the golden fixture has a back');
  }
  return analysis.sides.back;
};

/** Analyses that drive the evaluators down their failing and missing-input paths. */
const ANALYSES: Readonly<Record<string, () => GovernmentIdAnalysis>> = {
  golden,
  barcode: barcodeCard,
  degraded: () =>
    changed((analysis) => {
      const { front } = analysis.sides;
      front.quality = { ...front.quality, is_blurry: true, has_glare: true };
      front.document_quality = front.document_quality && {
        ...front.document_quality,
        blur_score: 2,
        tenengrad: 2,
        width_px: 120,
        glare_ratio_text: 0.4,
        glare_ratio_portrait: 0.4,
      };
      front.portrait_clarity = { face_width_px: 10, sharpness: 1, landmarks_score: 0.1 };
      front.portrait = null;
    }),
  'no document, no OCR': () =>
    changed((analysis) => {
      analysis.model_versions = {
        ...analysis.model_versions,
        text_detector: null,
        text_recognizer: null,
      };
      for (const side of [analysis.sides.front, back(analysis)]) {
        side.document = {
          found: false,
          quad: null,
          method: 'none',
          rectified_size: null,
          aspect_ratio: null,
          area_ratio: null,
        };
        side.document_quality = null;
        side.text = [];
        side.mrz = { found: false, format_guess: null, lines: [], line_confidences: [], box: null };
        side.phash = null;
        side.forensics = null;
        side.portrait_clarity = null;
      }
    }),
  tampered: () =>
    changed((analysis) => {
      for (const side of [analysis.sides.front, back(analysis)]) {
        if (side.forensics !== null) {
          side.forensics = {
            ...side.forensics,
            exif: { ...side.forensics.exif, software: 'Synthetic Photo Editor 1.0' },
            ela_score: 0.99,
            moire_score: 0.99,
            screen_grid_score: 0.99,
            chroma: { mean_saturation: 0, colorfulness: 0 },
            color_cast_score: 0.99,
            copy_move_score: 0.99,
            portrait_boundary_score: 0.99,
          };
        }
        side.text = side.text.map((line) => ({
          ...line,
          confidence: 0.4,
          stroke_width_cv: 0.9,
          stroke_width_mean: 9,
        }));
      }
      back(analysis).phash = analysis.sides.front.phash;
    }),
  'bad check digit, VIZ disagreeing': () =>
    changed((analysis) => {
      const mrz = back(analysis).mrz;
      mrz.lines = mrz.lines.map((line, index) => (index === 1 ? `9102144${line.slice(7)}` : line));
      analysis.sides.front.text = analysis.sides.front.text.map((line) =>
        line.text === '14 02 1990' ? { ...line, text: '15 03 1991' } : line,
      );
    }),
  'specimen text': () =>
    changed((analysis) => {
      analysis.sides.front.text = [
        ...analysis.sides.front.text,
        {
          text: 'SPECIMEN',
          confidence: 0.99,
          box: [40, 40, 200, 30],
          stroke_width_mean: 2,
          stroke_width_cv: 0.1,
        },
      ];
    }),
};

const portrait = golden().sides.front.portrait;
const otherFace = (visionFixture('embed-face') as { face: { embedding: number[] } }).face.embedding;

/** Provider outcomes of every kind. */
const PROVIDER_SETS: readonly GovernmentIdProviders[] = [
  {},
  { aamva: { kind: 'error' }, publicFigure: { kind: 'error' }, ageEstimate: { kind: 'error' } },
  {
    aamva: { kind: 'result', provider: PROVIDER, result: { outcome: 'match' } },
    publicFigure: { kind: 'result', provider: PROVIDER, result: { outcome: 'match' } },
    ageEstimate: {
      kind: 'result',
      provider: PROVIDER,
      result: { estimatedAge: 80, confidence: 0.9 },
    },
  },
  {
    aamva: {
      kind: 'result',
      provider: PROVIDER,
      result: { outcome: 'no_match', mismatchedFields: ['birthdate'] },
    },
    publicFigure: { kind: 'result', provider: PROVIDER, result: { outcome: 'gallery_empty' } },
    ageEstimate: { kind: 'result', provider: PROVIDER, result: { estimatedAge: 36 } },
  },
  {
    aamva: { kind: 'result', provider: PROVIDER, result: { outcome: 'not_found' } },
    publicFigure: { kind: 'result', provider: PROVIDER, result: { outcome: 'no_match' } },
  },
];

/** History, references and selfies that match, differ, or are missing. */
function context(index: number): Partial<GovernmentIdCheckInput> {
  const differing = index % 2 === 1;
  return {
    history: {
      repeat: {
        identificationNumberLookup: true,
        phashLookup: true,
        candidates: differing
          ? [
              {
                verificationId: 'ver_EARLIER',
                sameIdentificationNumber: true,
                phashDistance: 2,
                sameAccount: false,
              },
            ]
          : [],
      },
      inconsistentRepeat: {
        candidates: [
          {
            verificationId: 'ver_EARLIER',
            fields: {
              'name-first': differing ? 'ROWAN' : 'QUINN',
              'name-last': 'VALEMONT',
              birthdate: differing ? '1985-06-30' : '1990-02-14',
            },
            faceSimilarity: differing ? 0.01 : null,
          },
        ],
      },
    },
    references: differing
      ? {
          inquiryFields: {
            name_first: 'Rowan',
            name_last: 'Other',
            birthdate: '1980-01-01',
            identification_number: 'Z99999999',
            address_street_1: '1 Elsewhere Lane',
          },
          accountFields: { name_last: 'Different', birthdate: '1970-01-01' },
        }
      : { inquiryFields: null, accountFields: { name_first: 'Quinn' } },
    selfie:
      portrait === null
        ? null
        : {
            verificationId: 'ver_SELFIE',
            face: differing ? { ...portrait, embedding: otherFace } : portrait,
          },
  };
}

function evaluateAll(): CheckResult[] {
  const results: CheckResult[] = [];
  let index = 0;
  for (const [, make] of Object.entries(ANALYSES)) {
    for (const environment of ['sandbox', 'production'] as const) {
      for (const providers of PROVIDER_SETS) {
        const analysis = make();
        for (const requiredSides of ['both', 'front'] as const) {
          results.push(
            ...evaluateGovernmentIdChecks(
              {
                analysis,
                requiredSides,
                uploads: {
                  front: { sha256: 'a'.repeat(64) },
                  back: index % 3 === 0 ? { sha256: 'a'.repeat(64) } : null,
                },
                extraction: extractGovernmentId(analysis, { now: NOW }),
                environment,
                now: index % 4 === 0 ? new Date('2041-01-01T00:00:00.000Z') : NOW,
                step:
                  index % 5 === 0
                    ? { allowedCountries: ['DE'], allowedIdClasses: ['passport'] }
                    : {},
                providers,
                models: governmentIdModels(analysis.model_versions),
                ...context(index),
              },
              ALL,
            ),
          );
          index += 1;
        }
      }
    }
  }
  return results;
}

/** The results the worker writes itself: vision failures, unreadable images, re-embed failures. */
function workerResults(evaluated: readonly CheckResult[]): CheckResult[] {
  const reembedding: readonly string[] = REEMBEDDING_CHECKS;
  return [
    ...visionFailureChecks(ALL),
    ...unreadableImageChecks('government_id', ALL),
    ...evaluated.filter((result) => reembedding.includes(result.name)).map(executionError),
  ];
}

describe('the government ID checks contract (C29.2, C29.4)', () => {
  const evaluated = evaluateAll();
  const results = [...evaluated, ...workerResults(evaluated)];

  it('evaluates every government ID check of the registry, and the contract lists each one', () => {
    const registered = CHECK_REGISTRY.filter(
      (definition) => definition.verificationType === 'government_id',
    ).map((definition) => definition.id);
    expect([...GOVERNMENT_ID_EVALUATED_CHECKS].sort()).toEqual([...registered].sort());
    for (const id of registered) {
      expect(GOVERNMENT_ID_CHECK_IDS, id).toContain(id);
    }
    expect(new Set(evaluated.map((result) => result.name))).toEqual(new Set(registered));
  });

  it('emits only the reason codes GOVERNMENT_ID_CHECK_REASONS lists for each check', () => {
    const unlisted = results.flatMap((result) =>
      result.reasons
        .filter(
          (reason) =>
            !(
              Object.hasOwn(GOVERNMENT_ID_CHECK_REASONS, result.name)
                ? GOVERNMENT_ID_CHECK_REASONS[result.name as GovernmentIdCheckId]
                : []
            ).includes(reason),
        )
        .map((reason) => `${result.name}: ${reason}`),
    );
    expect([...new Set(unlisted)]).toEqual([]);
  });

  it('reaches every status, so the reasons above are not only the happy ones', () => {
    expect(new Set(evaluated.map((result) => result.status))).toEqual(
      new Set(['passed', 'failed', 'not_applicable']),
    );
    expect(results.length).toBeGreaterThan(1000);
  });

  it('carries the registry stage, a provenance and, for an H-tier decision, a confidence', () => {
    for (const result of results) {
      const definition = getCheckDefinition(result.name);
      expect(checkResultSchema.safeParse(result).success, result.name).toBe(true);
      expect(result.stage, result.name).toBe(definition?.stage);
      expect(result.provenance['implementation-version'], result.name).toBe(definition?.version);
      expect(typeof result.provenance.thresholds, result.name).toBe('object');
      if (definition?.tier === 'H' && (result.status === 'passed' || result.status === 'failed')) {
        expect(result.confidence, result.name).not.toBeNull();
      }
    }
  });

  it('names a pinned model only with its manifest digest', () => {
    const digests = new Set(Object.values(MODEL_DIGESTS).map((digest) => digest.sha256));
    for (const model of results.flatMap((result) => result.provenance.models ?? [])) {
      expect(digests).toContain(model.sha256);
    }
    expect(results.some((result) => (result.provenance.models ?? []).length > 0)).toBe(true);
  });
});
