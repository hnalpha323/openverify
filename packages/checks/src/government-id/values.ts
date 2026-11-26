/**
 * Small helpers the evaluators share: typed reads of a check's config values, the C32.1 sides an
 * analysis holds, and the pHash distance.
 */
import type { ThresholdValue } from '@openverify/core';
import type { Side } from '../extraction/extract.js';
import type { GovernmentIdAnalysisInput, IdSideAnalysisInput } from '../phase1/inputs.js';

export type ConfigValues = Readonly<Record<string, ThresholdValue>>;

/** A numeric config value, or `undefined` when the key is not set. */
export function numberOf(config: ConfigValues, key: string): number | undefined {
  const value = config[key];
  return typeof value === 'number' ? value : undefined;
}

/** A list config value, or `undefined` when the key is not set. */
export function listOf(config: ConfigValues, key: string): readonly string[] | undefined {
  const value = config[key];
  return Array.isArray(value) ? (value as readonly string[]) : undefined;
}

/** The config entries of `keys` that are set: the thresholds a result was judged against. */
export function thresholdsOf(
  config: ConfigValues,
  keys: readonly string[],
): Record<string, ThresholdValue> {
  return Object.fromEntries(
    keys.flatMap((key) => (config[key] === undefined ? [] : [[key, config[key]]])),
  );
}

export type { Side } from '../extraction/extract.js';

/** The analysed sides, front first. */
export function sidesOf(analysis: GovernmentIdAnalysisInput): [Side, IdSideAnalysisInput][] {
  const { front, back } = analysis.sides;
  return back === null
    ? [['front', front]]
    : [
        ['front', front],
        ['back', back],
      ];
}

/** Hamming distance of two 64-bit pHashes (16 hex characters each); `null` without both. */
export function phashDistance(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (a == null || b == null || !/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) {
    return null;
  }
  let difference = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let bits = 0;
  while (difference > 0n) {
    bits += Number(difference & 1n);
    difference >>= 1n;
  }
  return bits;
}

/** Whether a barcode is a PDF417, by zxing-cpp's format name. */
export const isPdf417 = (format: string): boolean => /PDF.?417/i.test(format);

/**
 * Whether the OCR models ran on the analysis (C32.1 `model_versions.text_detector`). An analysis
 * without model versions counts as OCR'd when its front carries a `text` field.
 */
export function ocrRan(analysis: GovernmentIdAnalysisInput): boolean {
  const versions = analysis.model_versions;
  return versions === undefined
    ? analysis.sides.front.text !== undefined
    : typeof versions.text_detector === 'string';
}

/**
 * Whether a feature the class keeps on `side` sits on a side the flow did not ask for and that was
 * not analysed: the back of a front-only step.
 */
export function sideNotRequested(
  analysis: GovernmentIdAnalysisInput,
  requiredSides: 'front' | 'back' | 'both',
  side: Side | null,
): boolean {
  if (side === null) {
    return false;
  }
  const analysed = side === 'front' ? true : analysis.sides.back !== null;
  return !analysed && requiredSides !== 'both' && requiredSides !== side;
}
