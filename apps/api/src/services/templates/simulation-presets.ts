/**
 * C156.4 (Workflow 9B, `api-templates-carry`): simulation presets. A passing and a failing preset per
 * verification type are built in (`builtin:<type>-passed`, `builtin:<type>-failed`, the API's type
 * names), and a user saves their own (`ssp_`, environment-scoped, theirs alone), whose scope is sealed
 * at rest. Every preset is labelled "synthetic values only".
 *
 * A built-in preset names no step, since it fits every version: it is served with `scope: null` and
 * resolved against the simulated version's own verification steps, where every step of its type
 * passes (a passing government ID with synthetic extracted values: an adult, a current ID) or fails,
 * and every other verification step passes. A user's preset is served with its scope only to a reader
 * holding `pii:view` (C174.5: operators may paste a real person's values there), and `null` otherwise.
 */
import {
  SIMULATION_PRESET_LABEL,
  STEP_VERIFICATION_TYPES,
  simulatedScopeSchema,
  toApiVerificationType,
  type ApiVerificationType,
  type SimulatedScope,
  type SimulationPresetResource,
  type SupportedVerificationType,
} from '@openverify/contracts';
import {
  createSimulationPreset,
  deleteSimulationPreset,
  getSimulationPreset,
  listSimulationPresets,
  type Db,
  type SimulationPreset,
} from '@openverify/db';
import type { FlowV2 } from '@openverify/flow-spec';
import { NotFoundError } from '../../errors.js';
import { stepVerificationType } from '../../flow-engine/verification-state.js';

/** A built-in preset: the verifications of one type pass or fail, every other one passes. */
export interface BuiltInSimulationPreset {
  id: string;
  name: string;
  verificationType: ApiVerificationType;
  outcome: 'passed' | 'failed';
}

/** Who reads or writes presets: a user in an environment, and whether they see personal data. */
export interface PresetReader {
  environmentId: string;
  /** `null` for an API key, which holds no presets. */
  userId: string | null;
  piiVisible: boolean;
}

/** The console's words for each verification type a flow step creates. */
const TYPE_NAMES: Readonly<Partial<Record<ApiVerificationType, string>>> = Object.freeze({
  'government-id': 'Government ID',
  selfie: 'Selfie',
  document: 'Document',
  'phone-number': 'Phone number',
  'email-address': 'Email address',
  database: 'Database',
  aamva: 'AAMVA',
  'government-id-nfc': 'Government ID chip',
  'crypto-wallet': 'Crypto wallet',
  'database-business': 'Business database',
  'business-website': 'Business website',
});

/** The verification types a flow step creates, in the step catalogue's order. */
const FLOW_VERIFICATION_TYPES: readonly ApiVerificationType[] = [
  ...new Set(
    Object.values(STEP_VERIFICATION_TYPES)
      .filter((type): type is SupportedVerificationType => type !== null)
      .map(toApiVerificationType),
  ),
];

/** Every built-in preset, in the order the console lists them. */
export const BUILT_IN_SIMULATION_PRESETS: readonly BuiltInSimulationPreset[] = Object.freeze(
  FLOW_VERIFICATION_TYPES.flatMap((type) =>
    (['passed', 'failed'] as const).map((outcome) => ({
      id: `builtin:${type}-${outcome}`,
      name: `${TYPE_NAMES[type] ?? type} ${outcome === 'passed' ? 'passes' : 'fails'}`,
      verificationType: type,
      outcome,
    })),
  ),
);

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** A date `years` from `now` (negative: before), the same month and day, UTC. */
function yearsFrom(now: Date, years: number): string {
  const date = new Date(now);
  date.setUTCFullYear(now.getUTCFullYear() + years);
  return isoDate(date);
}

/**
 * Synthetic extracted values of a passing verification, by type: a passing government ID is a
 * driving licence of an adult of 30, current for five more years (ours; synthetic, never a person).
 */
function passingExtractions(type: ApiVerificationType, now: Date): Record<string, unknown> | null {
  return type === 'government-id'
    ? {
        'country-code': 'US',
        'id-class': 'dl',
        birthdate: yearsFrom(now, -30),
        'expiration-date': yearsFrom(now, 5),
      }
    : null;
}

/** The scope of the built-in preset `id` for `flow`'s verification steps; `null` for no such id. */
export function builtInPresetScope(id: string, flow: FlowV2, now: Date): SimulatedScope | null {
  const preset = BUILT_IN_SIMULATION_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) {
    return null;
  }
  const verifications: NonNullable<SimulatedScope['verifications']> = {};
  for (const step of flow.steps) {
    const type = stepVerificationType(step);
    if (type === null) continue;
    const apiType = toApiVerificationType(type);
    const status = apiType === preset.verificationType ? preset.outcome : 'passed';
    const extractions = status === 'passed' ? passingExtractions(apiType, now) : null;
    verifications[step.id] = extractions === null ? { status } : { status, extractions };
  }
  return { verifications };
}

const builtInResource = (preset: BuiltInSimulationPreset): SimulationPresetResource => ({
  type: 'simulation-preset',
  id: preset.id,
  attributes: {
    name: preset.name,
    label: SIMULATION_PRESET_LABEL,
    'built-in': true,
    scope: null,
    'created-at': null,
  },
});

/** A stored scope as the contract reads it; one that no longer parses reads as empty. */
function storedScope(preset: SimulationPreset): SimulatedScope {
  const parsed = simulatedScopeSchema.safeParse(preset.scope);
  return parsed.success ? parsed.data : {};
}

function ownResource(preset: SimulationPreset, reader: PresetReader): SimulationPresetResource {
  return {
    type: 'simulation-preset',
    id: preset.id,
    attributes: {
      name: preset.name,
      label: SIMULATION_PRESET_LABEL,
      'built-in': false,
      scope: reader.piiVisible ? storedScope(preset) : null,
      'created-at': preset.createdAt.toISOString(),
    },
  };
}

/** The built-in presets and the reader's own, newest first. */
export async function listSimulationPresetResources(
  db: Db,
  reader: PresetReader,
): Promise<SimulationPresetResource[]> {
  const own =
    reader.userId === null
      ? []
      : await listSimulationPresets(db, reader.environmentId, reader.userId);
  return [
    ...BUILT_IN_SIMULATION_PRESETS.map(builtInResource),
    ...own.map((preset) => ownResource(preset, reader)),
  ];
}

const presetNotFound = (id: string) => new NotFoundError(`Simulation preset ${id} was not found.`);

/** The user a write belongs to: presets are a user's own, so an API key has none. */
function ownerOf(reader: PresetReader): string {
  if (reader.userId === null) {
    throw new NotFoundError('An API key holds no simulation presets.');
  }
  return reader.userId;
}

/** Saves a preset of the reader's own. */
export async function saveSimulationPreset(
  db: Db,
  reader: PresetReader,
  input: { id: string; name: string; scope: SimulatedScope },
): Promise<SimulationPresetResource> {
  const preset = await createSimulationPreset(db, reader.environmentId, {
    id: input.id,
    userId: ownerOf(reader),
    name: input.name,
    scope: input.scope,
  });
  return ownResource(preset, reader);
}

/** Deletes a preset of the reader's own. @throws {NotFoundError} for any other id. */
export async function deleteOwnSimulationPreset(
  db: Db,
  reader: PresetReader,
  id: string,
): Promise<void> {
  if (!(await deleteSimulationPreset(db, reader.environmentId, ownerOf(reader), id))) {
    throw presetNotFound(id);
  }
}

/**
 * The scope a simulate body's `meta.preset-id` names for `flow`: a built-in one resolved against
 * the flow, or the reader's own. @throws {NotFoundError} for an unknown or another user's preset.
 */
export async function presetScopeFor(
  db: Db,
  reader: PresetReader,
  presetId: string,
  flow: FlowV2,
  now: Date,
): Promise<SimulatedScope> {
  if (presetId.startsWith('builtin:')) {
    const scope = builtInPresetScope(presetId, flow, now);
    if (scope === null) throw presetNotFound(presetId);
    return scope;
  }
  if (reader.userId === null) {
    throw presetNotFound(presetId);
  }
  const preset = await getSimulationPreset(db, reader.environmentId, reader.userId, presetId);
  if (preset === null) {
    throw presetNotFound(presetId);
  }
  return storedScope(preset);
}
