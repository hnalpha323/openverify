/**
 * C156.4 (Workflow 9C, `dashboard-preview`): the operator's simulation presets on the dashboard API
 * (`/dashboard/simulation-presets`, `inquiry-templates:read`): the built-in passing and failing preset
 * per verification type (scope `null`), then the operator's own, every one labelled "synthetic values
 * only". A preset's scope is `null` without `pii:view`, so the console never offers to edit it then.
 */
import 'server-only';
import {
  idSchema,
  simulationPresetDocumentSchema,
  simulationPresetListDocumentSchema,
  type SimulatedScope,
  type SimulationPresetResource,
} from '@openverify/contracts';
import { z } from 'zod';
import { apiRequest } from './client';

const PRESETS_PATH = '/dashboard/simulation-presets';

/** `GET /dashboard/simulation-presets`: the built-ins first, then mine (unpaged). */
export async function listSimulationPresets(): Promise<readonly SimulationPresetResource[]> {
  const { data } = await apiRequest({
    method: 'GET',
    path: PRESETS_PATH,
    schema: simulationPresetListDocumentSchema,
  });
  return data;
}

/** `POST /dashboard/simulation-presets`: a named scope of mine, in the body only. */
export async function createSimulationPreset(
  name: string,
  scope: SimulatedScope,
): Promise<SimulationPresetResource> {
  const { data } = await apiRequest({
    method: 'POST',
    path: PRESETS_PATH,
    body: { data: { type: 'simulation-preset', attributes: { name, scope } } },
    schema: simulationPresetDocumentSchema,
  });
  return data;
}

/**
 * `DELETE /dashboard/simulation-presets/:id`: one of mine. A built-in or a malformed id is refused
 * here, before anything is sent.
 * @throws {TypeError} for an id that is not an `ssp_` id.
 */
export async function deleteSimulationPreset(id: string): Promise<void> {
  if (!idSchema('ssp').safeParse(id).success) {
    throw new TypeError('Only a preset of your own can be deleted');
  }
  await apiRequest({ method: 'DELETE', path: `${PRESETS_PATH}/${id}`, schema: z.undefined() });
}
