/**
 * C118.4, C118.5, C140.2 (Workflow 8B): a case as a run reads it. `triggerDocumentOf`
 * (`workflows/triggers/objects.ts`) reads a case's document here, and the manual runs
 * (`workflows/triggers/service.ts`) ask here whether an id can name a case. Owner
 * `api-case-workflows`; `foundation-8b` made the joins.
 *
 * A run reads the server API's case, unmasked (C120.6 masks at the exits). A case of another
 * environment reads as none, never as its object (C121.6).
 */
import { idSchema } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import type { TriggerDocument } from '@openverify/workflow-engine';
import { UNMASKED } from '../../../auth/pii.js';
import { caseResourceOf } from './case-view.js';

const CASE_ID = idSchema('case');

/** The case as a run reads it (unmasked, C120.6 masks at the exits); `null` when not held here. */
export async function caseTriggerDocumentOf(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TriggerDocument | null> {
  const resource = await caseResourceOf(db, environmentId, id, UNMASKED);
  return resource === null ? null : { data: resource };
}

/** Whether `id` can name a case of a manual run. */
export const caseObjectIdFits = (id: string): boolean => CASE_ID.safeParse(id).success;
