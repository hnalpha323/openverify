/**
 * C156.4 (Workflow 9A): a user's simulation presets (`ssp_`), their scope sealed for the row
 * (`simulation_presets.scope#<id>`; synthetic values only, though an operator may paste real ones,
 * C174.5). Owner: `api-templates`; frozen by `foundation-9a` (Stage 1b (T)).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { simulationPresets, type SimulationPresetRow } from '../schema.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, sealJson } from '../sealed.js';
import { inserted } from './rows.js';

/** A preset as the repository returns it: the scope opened, the ciphertext dropped. */
export type SimulationPreset = Omit<SimulationPresetRow, 'scopeSealed'> & {
  scope: Record<string, unknown>;
};

export interface NewSimulationPreset {
  id: string;
  userId: string;
  name: string;
  scope: Record<string, unknown>;
}

function opened(row: SimulationPresetRow): SimulationPreset {
  const { scopeSealed, ...rest } = row;
  return {
    ...rest,
    scope: openJson(SEALED.simulationPresetScope, row.id, scopeSealed) as Record<string, unknown>,
  };
}

export async function createSimulationPreset(
  db: Db,
  environmentId: string,
  input: NewSimulationPreset,
): Promise<SimulationPreset> {
  return opened(
    inserted(
      await db
        .insert(simulationPresets)
        .values({
          id: input.id,
          environmentId,
          userId: input.userId,
          name: input.name,
          scopeSealed: sealJson(SEALED.simulationPresetScope, input.id, input.scope),
        })
        .returning(),
      'createSimulationPreset',
    ),
  );
}

/** The user's presets in the environment, newest first. */
export async function listSimulationPresets(
  db: Db,
  environmentId: string,
  userId: string,
): Promise<SimulationPreset[]> {
  const rows = await db
    .select()
    .from(simulationPresets)
    .where(
      and(eq(simulationPresets.environmentId, environmentId), eq(simulationPresets.userId, userId)),
    )
    .orderBy(desc(simulationPresets.createdAt), desc(simulationPresets.id));
  return rows.map(opened);
}

/** The user's own preset in the environment, or `null`. */
export async function getSimulationPreset(
  db: Db,
  environmentId: string,
  userId: string,
  id: string,
): Promise<SimulationPreset | null> {
  const [row] = await db
    .select()
    .from(simulationPresets)
    .where(
      and(
        eq(simulationPresets.id, id),
        eq(simulationPresets.environmentId, environmentId),
        eq(simulationPresets.userId, userId),
      ),
    )
    .limit(1);
  return row === undefined ? null : opened(row);
}

/** Deletes the user's own preset; `false` when it is not theirs or not there. */
export async function deleteSimulationPreset(
  db: Db,
  environmentId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(simulationPresets)
    .where(
      and(
        eq(simulationPresets.id, id),
        eq(simulationPresets.environmentId, environmentId),
        eq(simulationPresets.userId, userId),
      ),
    )
    .returning({ id: simulationPresets.id });
  return deleted.length > 0;
}
