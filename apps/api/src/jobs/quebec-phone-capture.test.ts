/**
 * Phase 12A Stage 3 (integration-12a): a synthetic Quebec-format licence end to end. The vision
 * service's own answers for four captures of both sides (`contracts/fixtures/quebec-dl/vision/`,
 * written by `services/vision/tools/quebec_e2e.py` with the real models: sharp, phone JPEG, mild
 * blur, perspective) are parsed by the API's schema, extracted, checked under the seeded default
 * template and decided, as the worker does (`evaluateGovernmentIdVerification`):
 * - the five required fields come out of the barcode and the front together, of the front's
 *   printed text alone (the barcode removed), and of the barcode alone (the front's text removed);
 * - the capture checks pass at the calibrated Phase 12A blur thresholds
 *   (`docs/calibration/blur-phase12a.md`, which Stage 3 applies to the defaults);
 * - with the barcode the card passes, and from the printed text alone it goes to review (the
 *   issuer is not established: plan D12A-2). The cards are SPECIMEN-marked (C36 as amended by
 *   Phase 12A), so the specimen check fails them by design and is left out of those decisions.
 * Invented values and a public-domain face only.
 */
import { readFileSync } from 'node:fs';
import { evaluateGovernmentIdChecks, extractGovernmentId } from '@openverify/checks';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import {
  decideVerification,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import type { GovernmentIdAnalysis } from '../ports.js';
import { governmentIdAnalysisSchema } from '../vision/schemas.js';
import { governmentIdModels } from './models.js';

const NOW = new Date('2026-11-22T00:00:00.000Z');
const ROOT = new URL('../../../../', import.meta.url);
const CAPTURES = ['flat', 'phone-1080', 'phone-1080-soft', 'phone-1080-tilt'] as const;

const REQUIRED = {
  'name-first': 'MARIE',
  'name-last': 'TREMBLAY',
  birthdate: '1990-02-14',
  'identification-number': 'T123456789012',
  'expiration-date': '2029-02-14',
} as const;
type RequiredField = keyof typeof REQUIRED;
const FIELDS = Object.keys(REQUIRED) as RequiredField[];

/** The proposed `min-document-blur-score` and `min-document-tenengrad` of the calibration. */
function calibrated(): Record<string, number> {
  const document = readFileSync(new URL('docs/calibration/blur-phase12a.md', ROOT), 'utf8');
  const value = (key: string): number => {
    const match = new RegExp(`^\\| \`${key}\` \\| ([0-9.]+) \\|`, 'm').exec(document);
    if (match?.[1] === undefined) {
      throw new Error(`the calibration proposes no ${key}`);
    }
    return Number(match[1]);
  };
  return {
    'min-document-blur-score': value('min-document-blur-score'),
    'min-document-tenengrad': value('min-document-tenengrad'),
  };
}

/** The seeded default template's government ID config, at the calibrated blur thresholds. */
function templateConfig({ specimen = true } = {}): VerificationTemplateConfig {
  const seeded = defaultInquiryTemplateAttributes()['verification-config']['government-id'];
  if (seeded === undefined) {
    throw new Error('the default template has a government ID config');
  }
  const config: VerificationTemplateConfig = structuredClone(seeded);
  const blur = config.checks.id_blur_detection;
  if (blur === undefined) {
    throw new Error('the default template configures id_blur_detection');
  }
  config.checks.id_blur_detection = { ...blur, config: { ...blur.config, ...calibrated() } };
  if (!specimen) {
    config.checks.id_compromised_detection = { enabled: false, required: false };
  }
  return config;
}

type Mode = 'barcode and front' | 'front text alone' | 'barcode alone';

function analysisOf(capture: string, mode: Mode): GovernmentIdAnalysis {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`contracts/fixtures/quebec-dl/vision/${capture}.json`, ROOT), 'utf8'),
  );
  const analysis = governmentIdAnalysisSchema.parse(raw) as GovernmentIdAnalysis;
  if (mode === 'front text alone' && analysis.sides.back !== null) {
    analysis.sides.back.barcodes = [];
  }
  if (mode === 'barcode alone') {
    analysis.sides.front.text = [];
  }
  return analysis;
}

function run(capture: string, mode: Mode, config: VerificationTemplateConfig) {
  const analysis = analysisOf(capture, mode);
  const extraction = extractGovernmentId(analysis, { now: NOW });
  const results: CheckResult[] = evaluateGovernmentIdChecks(
    {
      analysis,
      requiredSides: 'both',
      uploads: { front: { sha256: 'a'.repeat(64) }, back: { sha256: 'b'.repeat(64) } },
      extraction,
      environment: 'sandbox',
      now: NOW,
      step: {},
      providers: {},
      models: governmentIdModels(analysis.model_versions),
    },
    config,
  );
  const status = (id: string) => results.find((result) => result.name === id)?.status;
  return { extraction, results, status, decision: decideVerification(results, config) };
}

const SOURCES: Record<Mode, string[]> = {
  'barcode and front': ['barcode', 'viz'],
  'front text alone': ['viz'],
  'barcode alone': ['barcode'],
};

describe.each(CAPTURES)('the synthetic Quebec licence, %s, end to end', (capture) => {
  it.each(Object.keys(SOURCES) as Mode[])('reads the five required fields from %s', (mode) => {
    const { extraction, status } = run(capture, mode, templateConfig());
    const { fields, fieldSources, disagreeingFields } = extraction.consolidated;

    for (const field of FIELDS) {
      expect(fields[field], field).toBe(REQUIRED[field]);
      expect(fieldSources[field], field).toEqual(SOURCES[mode]);
    }
    expect(disagreeingFields).toEqual([]);
    expect(status('id_extracted_properties_detection')).toBe('passed');
    expect(extraction.document.idClass).toBe('drivers_license');
  });

  it('reads the unlabeled names by the Quebec layout rule, and the number by its pattern', () => {
    const { viz } = run(capture, 'front text alone', templateConfig()).extraction.sources;
    if (viz === null) {
      throw new Error('the front was read');
    }
    const { readings } = viz;

    expect(readings['name-last']?.via).toBe('layout');
    expect(readings['name-first']?.via).toBe('layout');
    expect(readings['identification-number']?.via).toBe('pattern');
    expect(readings.birthdate?.via).toBe('label');
  });

  it('names the AAMVA issuer from the barcode only', () => {
    expect(run(capture, 'barcode and front', templateConfig()).extraction.document.issuer).toEqual({
      scheme: 'aamva',
      code: '604428',
      country: 'CA',
      jurisdiction: 'QC',
    });
    expect(
      run(capture, 'front text alone', templateConfig()).extraction.document.issuer,
    ).toBeNull();
  });

  it('passes the capture checks at the calibrated blur thresholds', () => {
    const { status } = run(capture, 'barcode and front', templateConfig());

    for (const id of [
      'id_unprocessable_submission_detection',
      'id_blur_detection',
      'id_glare_detection',
      'id_portrait_detection',
      'id_portrait_clarity_detection',
      'id_barcode_detection',
      'id_number_format_inconsistency_detection',
      'id_extraction_inconsistency_detection',
      'id_handwriting_detection',
    ]) {
      expect(status(id), id).toBe('passed');
    }
  });

  it('fails the SPECIMEN card on the specimen marker, by design, and on nothing else required', () => {
    const { results, decision } = run(capture, 'barcode and front', templateConfig());
    const config = templateConfig();
    const requiredFailures = results
      .filter((result) => result.status === 'failed' && config.checks[result.name]?.required)
      .map((result) => [result.name, result.reasons]);

    expect(decision.status).toBe('failed');
    expect(requiredFailures).toEqual([['id_compromised_detection', ['specimen_marker_found']]]);
  });

  it('passes with the barcode, and goes to review from the printed text alone (D12A-2)', () => {
    const config = templateConfig({ specimen: false });

    expect(run(capture, 'barcode and front', config).decision.status).toBe('passed');
    const viz = run(capture, 'front text alone', config);
    expect(viz.decision.status).toBe('needs_review');
    expect(viz.status('id_number_format_inconsistency_detection')).toBe('not_applicable');
  });
});
