/**
 * C120.6, C129.2 (Workflow 8B): a case as the workflow side reads it, the case the routes serve
 * (`caseResource`, `services/cases/resources.ts`, `api-cases`): its status, SLA state, held objects
 * and fields, under `mask`. A run reads it unmasked, because it acts on its grant and its values are
 * sealed and masked at every exit; a reader's mask is applied where a person reads (P38).
 */
import type { CaseResource } from '@openverify/contracts';
import { getCaseRow, type Db } from '@openverify/db';
import type { PiiMask } from '../../../auth/pii.js';
import { caseResource } from '../../../services/cases/resources.js';

/** The case under `mask`, or `null` when this environment holds no such case (C121.6). */
export async function caseResourceOf(
  db: Db,
  environmentId: string,
  id: string,
  mask: PiiMask,
): Promise<CaseResource | null> {
  const row = await getCaseRow(db, environmentId, id);
  return row === null ? null : caseResource(db, environmentId, row, mask);
}
