import { z } from 'zod';
import { thresholdBasisSchema } from './check-config.js';
import { checkNameSchema } from './check-registry.js';
import { checkStageSchema, checkStatusSchema, checkTypeSchema } from './enums.js';

/**
 * Machine-readable reason code such as `po_box_detected`. Reasons are codes,
 * not prose, so clients can translate them and no PII leaks into them.
 */
export const reasonCodeSchema = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be a snake_case reason code');

/** A kebab-case threshold name, as the template config keys (C11, C29.5). */
const thresholdNameSchema = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'must be a kebab-case threshold name');

/**
 * A threshold's value: a number, a flag, an option, a list (for example required fields), or
 * (C51.3) a list of match groups, each naming kebab-case fields and the level each must reach.
 */
export const thresholdValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.array(z.string()).readonly(),
  z.array(z.record(thresholdNameSchema, z.string()).readonly()).readonly(),
]);
export type ThresholdValue = z.infer<typeof thresholdValueSchema>;

/** A model a result rests on, pinned by the SHA-256 of its weights (`models/manifest.json`). */
export const checkModelSchema = z.strictObject({
  id: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase SHA-256 hex digest'),
});
export type CheckModel = z.infer<typeof checkModelSchema>;

/** The provider an A-tier result came from (C35); `sandbox` marks a sandbox provider. */
export const checkProviderSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/, 'must be a lowercase provider id'),
  sandbox: z.boolean(),
});
export type CheckProvider = z.infer<typeof checkProviderSchema>;

/**
 * How a result was produced (C29.2, ADR 0002 §3f): the check's implementation version, the
 * models and provider it used (present only when used), and every threshold it was judged
 * against after the template config was applied.
 */
export const checkProvenanceSchema = z.strictObject({
  'implementation-version': z.int().min(1),
  models: z.array(checkModelSchema).min(1).readonly().optional(),
  provider: checkProviderSchema.optional(),
  thresholds: z.record(thresholdNameSchema, thresholdValueSchema),
  /**
   * C39.3 (an additive C29.2 member): the basis of each threshold key's value, `calibrated` or
   * `provisional`. Results written before Phase 4 have none.
   */
  'threshold-basis': z.record(thresholdNameSchema, thresholdBasisSchema).optional(),
});
export type CheckProvenance = z.infer<typeof checkProvenanceSchema>;

/**
 * Outcome of one check, as produced by `@openverify/checks` (C2, C29.2). `stage` comes from the
 * registry; `confidence` is in [0, 1], or `null` when the check has none (an H-tier `passed` or
 * `failed` result always carries one). `metadata` holds scores, counts and field names, never
 * PII, OCR text or embeddings (C29.3).
 */
export const checkResultSchema = z.strictObject({
  name: checkNameSchema,
  status: checkStatusSchema,
  type: checkTypeSchema,
  reasons: z.array(reasonCodeSchema),
  metadata: z.record(z.string(), z.unknown()),
  stage: checkStageSchema,
  confidence: z.number().min(0).max(1).nullable(),
  provenance: checkProvenanceSchema,
});

export type CheckResult = z.infer<typeof checkResultSchema>;
