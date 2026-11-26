'use server';

/**
 * C156.1, C156.4 (Workflow 9C, `dashboard-preview`): the preview page's server actions. Each checks
 * its input with the contract's request schema before calling the API as the operator, and answers
 * `{ ok, data } | { ok: false, problem }` with the API's 422 pointers kept, so the page puts each
 * beside its control. A simulated scope or a preset's values travel in the body only: never in a
 * URL, a log line or an audit (C174.5). Nothing here is stored but a preset the operator saves.
 */
import {
  idSchema,
  previewInquiryTemplateVersionBodySchema,
  simulateInquiryTemplateVersionBodySchema,
  simulatedScopeSchema,
  type SimulationPresetResource,
} from '@openverify/contracts';
import { z } from 'zod';
import type { ActionResult } from '../../../../lib/action-state';
import { parseInput, runAction } from '../../../../lib/api/action';
import {
  createSimulationPreset,
  deleteSimulationPreset,
} from '../../../../lib/api/simulation-presets';
import {
  previewTemplateVersion,
  simulateTemplateVersion,
  type TemplatePreviewDocument,
  type TemplateSimulationDocument,
} from '../../../../lib/api/template-preview';

const GUARD = { permissions: ['inquiry-templates:read'] } as const;
const versionId = idSchema('itmplv');

const previewInput = z.strictObject({
  'version-id': versionId,
  body: previewInquiryTemplateVersionBodySchema,
});
const simulateInput = z.strictObject({
  'version-id': versionId,
  body: simulateInquiryTemplateVersionBodySchema,
});
const presetInput = z.strictObject({
  name: z.string().trim().min(1).max(100),
  scope: simulatedScopeSchema,
});
const removeInput = z.strictObject({ id: idSchema('ssp') });

/** `POST /inquiry-template-versions/:id/preview`: `{ 'version-id', body }`. */
export async function resolvePreview(
  input: unknown,
): Promise<ActionResult<TemplatePreviewDocument>> {
  return runAction(GUARD, async () => {
    const { 'version-id': id, body } = parseInput(previewInput, input);
    return previewTemplateVersion(id, body);
  });
}

/** `POST /inquiry-template-versions/:id/simulate`: `{ 'version-id', body }`. */
export async function runSimulation(
  input: unknown,
): Promise<ActionResult<TemplateSimulationDocument>> {
  return runAction(GUARD, async () => {
    const { 'version-id': id, body } = parseInput(simulateInput, input);
    return simulateTemplateVersion(id, body);
  });
}

/** `POST /dashboard/simulation-presets`: `{ name, scope }`, a preset of my own. */
export async function savePreset(input: unknown): Promise<ActionResult<SimulationPresetResource>> {
  return runAction(GUARD, async () => {
    const { name, scope } = parseInput(presetInput, input);
    return createSimulationPreset(name, scope);
  });
}

/** `DELETE /dashboard/simulation-presets/:id`: `{ id }`, one of mine; a built-in is refused. */
export async function removePreset(input: unknown): Promise<ActionResult> {
  return runAction(GUARD, async () => {
    const { id } = parseInput(removeInput, input);
    await deleteSimulationPreset(id);
    return undefined;
  });
}
