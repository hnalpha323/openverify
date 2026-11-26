/** The content of one migration golden file (test support for C147.10). */
import { migrateFlowWithNotes, type MigrationNote } from '../migrate.js';
import type { FlowV2 } from '../schemas/flow.js';
import type { V1Source } from './v1-sources.js';

export interface MigrationGolden {
  readonly source: string;
  readonly flow: FlowV2;
  readonly notes: readonly MigrationNote[];
}

export function migrationGolden(source: V1Source): MigrationGolden {
  const migrated = migrateFlowWithNotes(source.flow);
  return { source: source.source, flow: migrated.flow, notes: migrated.notes };
}
