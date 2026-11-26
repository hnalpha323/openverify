/**
 * Reading a stored definition (plan C113.7). Stored versions are an audit record and are never
 * rewritten, so each `schema-version` reads through pure upgrade functions, one per version, each
 * with its golden fixtures. Version 1 is the first, so the table is empty until there is a version 2.
 */
import {
  WORKFLOW_SCHEMA_VERSION,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from '@openverify/contracts';

/** One step up: a pure function from a definition of version `n` to one of `n + 1`. */
export type DefinitionUpgrade = (definition: Readonly<Record<string, unknown>>) => unknown;

/** Keyed by the version each upgrade reads. */
export const DEFINITION_UPGRADES: Readonly<Record<number, DefinitionUpgrade>> = Object.freeze({});

/** A definition that cannot be read. It quotes nothing of the definition. */
export class DefinitionReadError extends Error {
  override readonly name = 'DefinitionReadError';
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function versionOf(raw: unknown): number {
  const version = isRecord(raw) ? raw['schema-version'] : undefined;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new DefinitionReadError('A definition states its schema version as an integer');
  }
  if (version > WORKFLOW_SCHEMA_VERSION) {
    throw new DefinitionReadError('This definition is newer than the engine');
  }
  return version;
}

/**
 * C113.7: a stored definition, upgraded to the current schema version and parsed by its schema.
 * @throws {DefinitionReadError} for a definition no upgrade reaches or the schema refuses.
 */
export function readDefinition(
  raw: unknown,
  upgrades: Readonly<Record<number, DefinitionUpgrade>> = DEFINITION_UPGRADES,
): WorkflowDefinition {
  let current = raw;
  let version = versionOf(current);
  while (version < WORKFLOW_SCHEMA_VERSION) {
    const upgrade = Object.hasOwn(upgrades, version) ? upgrades[version] : undefined;
    if (upgrade === undefined) {
      throw new DefinitionReadError('No upgrade reads this schema version');
    }
    current = upgrade(current as Readonly<Record<string, unknown>>);
    const next = versionOf(current);
    if (next <= version) {
      throw new DefinitionReadError('An upgrade must move a definition to a later version');
    }
    version = next;
  }
  const parsed = workflowDefinitionSchema.safeParse(current);
  if (!parsed.success) {
    throw new DefinitionReadError('A stored definition does not match its schema');
  }
  return parsed.data;
}
