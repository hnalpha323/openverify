import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FaceEmbeddingResult, GovernmentIdAnalysis, SelfieAnalysis } from '../ports.js';
import {
  faceEmbeddingResultSchema,
  governmentIdAnalysisSchema,
  selfieAnalysisSchema,
} from './schemas.js';

/** The C6 golden fixtures written by the vision service (synthetic embeddings). */
function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../../../../contracts/fixtures/vision/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

/** A deep copy of `value` with `patch` applied at the dotted `path`. */
function patched(value: unknown, path: string, patch: unknown): unknown {
  const copy = structuredClone(value) as Record<string, unknown>;
  const keys = path.split('.');
  const last = keys.pop() ?? '';
  let node: Record<string, unknown> = copy;
  for (const key of keys) {
    node = node[key] as Record<string, unknown>;
  }
  if (patch === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test helper
    delete node[last];
  } else {
    node[last] = patch;
  }
  return copy;
}

const governmentId = fixture('analyze-government-id');
const selfie = fixture('analyze-selfie');
const embedFace = fixture('embed-face');

describe('C6 golden fixtures', () => {
  it('parse POST /v1/analyze/government-id unchanged', () => {
    const parsed: GovernmentIdAnalysis = governmentIdAnalysisSchema.parse(governmentId);
    expect(parsed).toEqual(governmentId);
    expect(parsed.sides.front.portrait?.embedding).toHaveLength(128);
    expect(parsed.sides.back?.portrait).toBeNull();
  });

  it('parse POST /v1/analyze/selfie unchanged', () => {
    const parsed: SelfieAnalysis = selfieAnalysisSchema.parse(selfie);
    expect(parsed).toEqual(selfie);
    expect(parsed.poses.center.face?.embedding).toHaveLength(128);
    expect(parsed.poses.right).toBeNull();
  });

  it('parse POST /v1/embed/face unchanged', () => {
    const parsed: FaceEmbeddingResult = faceEmbeddingResultSchema.parse(embedFace);
    expect(parsed).toEqual(embedFace);
    expect(parsed.face_count).toBe(1);
  });
});

describe('governmentIdAnalysisSchema rejects responses outside C6', () => {
  const front = 'sides.front';
  it.each([
    ['a missing back key (null is required)', 'sides.back', undefined],
    ['an unknown member', 'sides.front.extra', true],
    ['a 127-value embedding', `${front}.portrait.embedding`, new Array(127).fill(0.088)],
    ['a non-unit embedding', `${front}.portrait.embedding`, new Array(128).fill(1)],
    ['a string in the embedding', `${front}.portrait.embedding.0`, '0.1'],
    ['a zero-width box', `${front}.faces.0.bbox`, [1, 2, 0, 4]],
    ['a three-value box', `${front}.faces.0.bbox`, [1, 2, 3]],
    ['a score above 1', `${front}.faces.0.score`, 1.2],
    ['a negative blur score', `${front}.quality.blur_score`, -1],
    ['a glare ratio above 1', `${front}.quality.glare_ratio`, 1.5],
    ['a brightness above 1', `${front}.quality.brightness`, 2],
    ['a string flag', `${front}.quality.is_blurry`, 'false'],
    ['an empty detector name', 'model_versions.detector', ''],
    ['a missing recognizer', 'model_versions.recognizer', undefined],
  ])('%s', (_label, path, value) => {
    expect(governmentIdAnalysisSchema.safeParse(patched(governmentId, path, value)).success).toBe(
      false,
    );
  });

  it('accepts additional model version names', () => {
    const value = patched(governmentId, 'model_versions.quality', 'laplacian-v1');
    expect(governmentIdAnalysisSchema.safeParse(value).success).toBe(true);
  });

  it('accepts a front without a portrait and a missing back', () => {
    const value = patched(patched(governmentId, 'sides.front.portrait', null), 'sides.back', null);
    expect(governmentIdAnalysisSchema.safeParse(value).success).toBe(true);
  });

  it('accepts a box crossing the image edge', () => {
    const value = patched(governmentId, 'sides.front.faces.0.bbox', [-4.5, -2, 100, 120]);
    expect(governmentIdAnalysisSchema.safeParse(value).success).toBe(true);
  });
});

describe('selfieAnalysisSchema rejects responses outside C6', () => {
  it.each([
    ['a missing right pose key', 'poses.right', undefined],
    ['a missing center pose', 'poses.center', null],
    ['a short center embedding', 'poses.center.face.embedding', [1]],
    ['a negative score', 'poses.center.faces.0.score', -0.1],
  ])('%s', (_label, path, value) => {
    expect(selfieAnalysisSchema.safeParse(patched(selfie, path, value)).success).toBe(false);
  });
});

describe('faceEmbeddingResultSchema rejects responses outside C6', () => {
  it.each([
    ['a negative face count', 'face_count', -1],
    ['a fractional face count', 'face_count', 1.5],
    ['a missing face key', 'face', undefined],
  ])('%s', (_label, path, value) => {
    expect(faceEmbeddingResultSchema.safeParse(patched(embedFace, path, value)).success).toBe(
      false,
    );
  });

  it('accepts no face', () => {
    const value = patched(patched(embedFace, 'face', null), 'face_count', 0);
    expect(faceEmbeddingResultSchema.safeParse(value).success).toBe(true);
  });
});

describe('C32.1 government ID analysis v2', () => {
  const barcodeOnly = () => fixture('analyze-government-id-barcode');

  it('parses both v2 golden fixtures unchanged, the barcode-only image included', () => {
    for (const value of [governmentId, barcodeOnly()]) {
      expect(governmentIdAnalysisSchema.parse(value)).toEqual(value);
    }
    expect(governmentIdAnalysisSchema.parse(barcodeOnly())).toMatchObject({
      sides: { front: { barcodes: [{ format: 'PDF417' }], document: { found: false } } },
    });
  });

  it('names the text models, or null while no OCR model ran', () => {
    const value = patched(
      patched(governmentId, 'model_versions.text_detector', null),
      'model_versions.text_recognizer',
      null,
    );
    expect(governmentIdAnalysisSchema.safeParse(value).success).toBe(true);
    expect(
      governmentIdAnalysisSchema.safeParse(
        patched(governmentId, 'model_versions.text_detector', undefined),
      ).success,
    ).toBe(false);
  });

  it('accepts a side where nothing was measured', () => {
    let value: unknown = governmentId;
    for (const [path, patch] of [
      ['sides.front.document_quality', null],
      ['sides.front.portrait_clarity', null],
      ['sides.front.forensics', null],
      ['sides.front.phash', null],
      ['sides.front.text', []],
    ] as const) {
      value = patched(value, path, patch);
    }
    expect(governmentIdAnalysisSchema.safeParse(value).success).toBe(true);
  });

  const front = 'sides.front';
  const back = 'sides.back';
  it.each([
    [
      'a quad with three corners',
      `${front}.document.quad`,
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    ],
    ['an unknown detection method', `${front}.document.method`, 'hough'],
    ['an area ratio above 1', `${front}.document.area_ratio`, 1.2],
    ['a found document without a size', `${front}.document.rectified_size`, null],
    ['a zero document width', `${front}.document_quality.width_px`, 0],
    ['an empty text line', `${front}.text.0.text`, ''],
    ['a text line of 201 characters', `${front}.text.0.text`, 'A'.repeat(201)],
    ['a text confidence above 1', `${front}.text.0.confidence`, 1.1],
    ['a lower-case MRZ line', `${back}.mrz.lines.0`, 'i<uto'],
    ['an MRZ line with a stray character', `${back}.mrz.lines.1`, '900214?F'],
    ['a fourth MRZ line', `${back}.mrz.lines.3`, 'ABC'],
    ['an MRZ confidence per line missing', `${back}.mrz.line_confidences`, [0.9]],
    ['an unknown MRZ format', `${back}.mrz.format_guess`, 'TD4'],
    ['GPS coordinates in the EXIF summary', `${front}.forensics.exif.gps_latitude`, 45.5],
    ['an ELA score above 1', `${front}.forensics.ela_score`, 1.5],
    ['a JPEG quality of 0', `${front}.forensics.jpeg.quality_estimate`, 0],
    ['an upper-case perceptual hash', `${front}.phash`, '0123456789ABCDEF'],
    ['a short perceptual hash', `${front}.phash`, '0123'],
    ['an unknown side member', `${front}.ocr_text`, 'UTOPIA'],
  ])('rejects %s', (_label, path, value) => {
    expect(governmentIdAnalysisSchema.safeParse(patched(governmentId, path, value)).success).toBe(
      false,
    );
  });

  it.each([
    ['a barcode whose bytes are not base64', 'sides.front.barcodes.0.bytes_b64', 'not base64!'],
    ['a barcode without a format', 'sides.front.barcodes.0.format', ''],
  ])('rejects %s', (_label, path, value) => {
    expect(governmentIdAnalysisSchema.safeParse(patched(barcodeOnly(), path, value)).success).toBe(
      false,
    );
  });

  it('refuses more than 200 text lines', () => {
    const value = structuredClone(governmentId) as {
      sides: { front: { text: unknown[] } };
    };
    const line = value.sides.front.text[0];
    value.sides.front.text = new Array(201).fill(line);
    expect(governmentIdAnalysisSchema.safeParse(value).success).toBe(false);
  });
});

describe('Phase 12A C12: the text_layout document method', () => {
  const found = (method: string) =>
    patched(governmentId, 'sides.front.document', {
      ...(governmentId as { sides: { front: { document: Record<string, unknown> } } }).sides.front
        .document,
      method,
    });

  it('parses a document outline fitted from the text lines and portrait', () => {
    const parsed = governmentIdAnalysisSchema.parse(found('text_layout'));
    expect(parsed.sides.front.document.method).toBe('text_layout');
  });

  it('still refuses an unknown method', () => {
    expect(governmentIdAnalysisSchema.safeParse(found('guessed')).success).toBe(false);
  });
});
