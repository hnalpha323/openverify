/**
 * Workflow 10B Stage 1a (contracts-10b): the shapes of the files the 10B builders write. Each JSON
 * Schema compiles, and a minimal instance of each passes it, so document-guidance, selfie-guidance and
 * the client owners write against a valid contract (C202.1, C202.2, C204.1, C224.4).
 */
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const FIXTURES = new URL('../../../contracts/fixtures/', import.meta.url);
const schemaOf = (path: string): object =>
  JSON.parse(readFileSync(new URL(path, FIXTURES), 'utf8')) as object;
/** A fresh validator per schema: each schema's `$id` registers once per Ajv instance. */
const compile = (path: string) =>
  new Ajv2020({ allErrors: true, strict: false }).compile(schemaOf(path));

describe('the 10B fixture shapes', () => {
  it.each([
    'flow/document-capture.schema.json',
    'flow/document-quality-vectors.schema.json',
    'flow/selfie-guidance-vectors.schema.json',
    'flow-requests/android/multipart.schema.json',
  ])('%s compiles', (path) => {
    expect(() => compile(path)).not.toThrow();
  });

  it('accepts a multipart fixture and refuses one that carries the file bytes', () => {
    const validate = compile('flow-requests/android/multipart.schema.json');
    const file = { name: 'file', filename: 'front.jpg', 'content-type': 'image/jpeg', size: 2048 };
    expect(validate({ fields: { kind: 'front', 'capture-trigger': 'auto' }, file })).toBe(true);
    expect(validate({ fields: { kind: 'front' }, file: { ...file, bytes: 'c3ludGhldGlj' } })).toBe(
      false,
    );
  });

  it('holds the document client constants to their fixed members (C202.2)', () => {
    const validate = compile('flow/document-capture.schema.json');
    const client = {
      'hold-ms': 500,
      'guidance-hz': 8,
      'analysis-width-px': 640,
      'barcode-analysis-width-px': 1280,
      'manual-shutter-after-ms': 10_000,
      'sharpness-laplacian-variance-min': 1,
      'sharpness-tenengrad-min': 1,
      'glare-share-max': 0.1,
      'brightness-mean-min': 1,
      'brightness-mean-max': 254,
      'framing-edge-ratio-min': 1,
      'mrz-band-edge-density-min': 0.1,
    };
    const calibration = {
      report: 'docs/calibration/android-document-guidance.md',
      covers: 'synthetic renders only',
    };
    expect(
      validate({
        format: 1,
        description: 'x',
        client,
        basis: { 'hold-ms': 'synthetic' },
        calibration,
      }),
    ).toBe(true);
    expect(
      validate({
        format: 1,
        description: 'x',
        client: { ...client, 'guidance-hz': 30 },
        basis: {},
        calibration,
      }),
    ).toBe(false);
  });
});
