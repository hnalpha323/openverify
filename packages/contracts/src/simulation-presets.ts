/**
 * C156.4 (Workflow 9A Stage 1a, (T)): simulation presets. A passing and a failing preset per
 * verification type are built in, from the synthetic fixtures (`builtin:<type>-passed`,
 * `builtin:<type>-failed`); a user saves their own (`ssp_`, environment-scoped, theirs alone), whose
 * values are sealed and labelled "synthetic values only". The dashboard routes are
 * `GET`/`POST /api/v1/dashboard/simulation-presets` and `DELETE .../:id` (the owner's only).
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  singleDocumentSchema,
  timestampSchema,
} from './json-api.js';
import { simulatedScopeSchema } from './template-routes.js';

export const SIMULATION_PRESET_LABEL = 'synthetic values only';

export const simulationPresetAttributesSchema = z.strictObject({
  name: z.string().min(1).max(100),
  /** Always the same words: a preset holds synthetic values only. */
  label: z.literal(SIMULATION_PRESET_LABEL),
  'built-in': z.boolean(),
  /** PII in logs and masked without `pii:view` (C174.5): operators may paste real values. */
  scope: simulatedScopeSchema.nullable(),
  'created-at': timestampSchema.nullable(),
});

export const simulationPresetResourceSchema = z.strictObject({
  type: z.literal('simulation-preset'),
  id: z.union([idSchema('ssp'), z.string().regex(/^builtin:[a-z0-9_-]{1,80}$/)]),
  attributes: simulationPresetAttributesSchema,
});
export type SimulationPresetResource = z.infer<typeof simulationPresetResourceSchema>;

export const simulationPresetDocumentSchema = singleDocumentSchema(simulationPresetResourceSchema);
export const simulationPresetListDocumentSchema = listDocumentSchema(
  simulationPresetResourceSchema,
);

export const createSimulationPresetBodySchema = requestDocumentSchema(
  'simulation-preset',
  z.strictObject({ name: z.string().min(1).max(100), scope: simulatedScopeSchema }),
);
export type CreateSimulationPresetBody = z.infer<typeof createSimulationPresetBodySchema>;

/** C174.5: the PII names of the preset resource and its bodies. */
export const PII_SIMULATION_PRESET_ATTRIBUTES: readonly string[] = Object.freeze(['scope']);
