import { describe, expect, it } from 'vitest';
import { extractGovernmentId } from '../extraction/extract.js';
import { InvalidCheckConfigError } from '../result.js';
import { goldenAnalysis } from '../testing/fixtures.js';
import { NOW, contextFor, template } from '../testing/context.js';
import { checkConfigOf, governmentIdContext, modelsOf } from './context.js';

const DETECTOR = { id: 'yunet-2026may', sha256: 'a'.repeat(64) };
const TEXT = { id: 'pp-ocrv6-small-det', sha256: 'b'.repeat(64) };

describe('governmentIdContext', () => {
  it('derives the extraction from the analysis, at the evaluation instant', () => {
    const context = contextFor();
    expect(context.extraction).toEqual(extractGovernmentId(goldenAnalysis(), { now: NOW }));
    expect(context.now).toBe(NOW);
    expect(context.environment).toBe('sandbox');
  });

  it('takes the extraction the worker built', () => {
    const extraction = extractGovernmentId({
      ...goldenAnalysis(),
      sides: { ...goldenAnalysis().sides, back: null },
    });
    expect(contextFor({ extraction }).extraction).toBe(extraction);
  });

  it('defaults to a production environment and the current time', () => {
    const before = Date.now();
    const context = governmentIdContext(
      { analysis: goldenAnalysis(), requiredSides: 'front', uploads: { front: null, back: null } },
      template(),
    );
    expect(context.environment).toBe('production');
    expect(context.now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('looks up the feature row of the established class: Utopia has one in a sandbox only (C30.7)', () => {
    expect(contextFor().features).toMatchObject({ row: 'sandbox-utopia-td1', mrzSide: 'back' });
    expect(contextFor({ environment: 'production' }).features).toBeNull();
  });
});

describe('checkConfigOf', () => {
  it('merges the template config over the defaults', () => {
    expect(checkConfigOf(contextFor(), 'id_expired_detection')).toEqual({ 'grace-days': 0 });
    const context = contextFor({}, template({ id_expired_detection: { 'grace-days': 30 } }));
    expect(checkConfigOf(context, 'id_expired_detection')).toEqual({ 'grace-days': 30 });
    expect(
      checkConfigOf(
        contextFor({}, template({ id_blur_detection: { 'min-blur-score': 150 } })),
        'id_blur_detection',
      ),
    ).toEqual({
      'min-blur-score': 150,
      'min-document-blur-score': 67.1,
      'min-document-width-px': 616,
    });
  });

  it('gives a check without a schema an empty config', () => {
    expect(checkConfigOf(contextFor(), 'id_compromised_detection')).toEqual({});
  });

  it('refuses a config its schema refuses', () => {
    const context = contextFor({}, template({ id_expired_detection: { 'grace-days': 9999 } }));
    expect(() => checkConfigOf(context, 'id_expired_detection')).toThrow(InvalidCheckConfigError);
  });
});

describe('modelsOf', () => {
  it('lists the models the worker named, in the order asked', () => {
    const context = contextFor({ models: { faceDetector: DETECTOR, textDetector: TEXT } });
    expect(modelsOf(context, ['textDetector', 'faceDetector', 'faceRecognizer'])).toEqual([
      TEXT,
      DETECTOR,
    ]);
    expect(modelsOf(context, ['faceRecognizer'])).toBeUndefined();
    expect(modelsOf(contextFor(), ['faceDetector'])).toBeUndefined();
  });
});
