/**
 * C136.4 (Workflow 8B; P25): the HMAC keys of a case's `searchable` fields. Owner `api-cases`;
 * `foundation-8b` froze the names. `blind-index:rebuild` recomputes them.
 *
 * A key is labelled per case template and field key (P25), so equal values in two fields or two
 * templates never key alike: the input is `case/<template id>/<field key>|<text>`, under the case
 * field's own label (`identifier-case-field`, Workflow 8B Stage 4), so no case key can equal a
 * transaction field's.
 */
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { identifierKey } from '../blind-index.js';
import type { Db } from '../client.js';
import { caseFieldKeys, cases, caseTemplateVersions } from '../tables/cases.js';

/** The keyed value of one searchable case field (64 hex). */
export function caseFieldValueKey(
  key: Uint8Array,
  input: { environmentId: string; caseTemplateId: string; fieldKey: string; text: string },
): string {
  return identifierKey(key, {
    environmentId: input.environmentId,
    kind: 'identifier-case-field',
    input: `case/${input.caseTemplateId}/${input.fieldKey}|${input.text}`,
  });
}

/** Replaces a case's keys with `keys` (`{ fieldKey, valueKey }`, each value key 64 hex). */
export async function replaceCaseFieldKeys(
  tx: Db,
  environmentId: string,
  caseId: string,
  keys: readonly { fieldKey: string; valueKey: string }[],
): Promise<void> {
  await tx
    .delete(caseFieldKeys)
    .where(and(eq(caseFieldKeys.environmentId, environmentId), eq(caseFieldKeys.caseId, caseId)));
  if (keys.length > 0) {
    await tx
      .insert(caseFieldKeys)
      .values(keys.map((key) => ({ environmentId, caseId, ...key })))
      .onConflictDoNothing();
  }
}

/** C139.1: deletes the keys of these cases. */
export async function deleteCaseFieldKeys(
  tx: Db,
  environmentId: string,
  caseIds: readonly string[],
): Promise<void> {
  if (caseIds.length === 0) {
    return;
  }
  await tx
    .delete(caseFieldKeys)
    .where(
      and(
        eq(caseFieldKeys.environmentId, environmentId),
        inArray(caseFieldKeys.caseId, [...caseIds]),
      ),
    );
}

/** A case's held keys (`blind-index:rebuild` compares them with the recomputed ones). */
export async function listCaseFieldKeys(
  db: Db,
  environmentId: string,
  caseId: string,
): Promise<{ fieldKey: string; valueKey: string }[]> {
  return db
    .select({ fieldKey: caseFieldKeys.fieldKey, valueKey: caseFieldKeys.valueKey })
    .from(caseFieldKeys)
    .where(and(eq(caseFieldKeys.environmentId, environmentId), eq(caseFieldKeys.caseId, caseId)))
    .orderBy(asc(caseFieldKeys.fieldKey), asc(caseFieldKeys.valueKey));
}

/** One unredacted case with its pinned version's field schemas, for `blind-index:rebuild`. */
export interface CaseForRebuild {
  id: string;
  environmentId: string;
  caseTemplateId: string;
  fieldSchemas: unknown;
}

/** Unredacted cases across environments, by id after `afterId`, `limit` at most. */
export async function listCasesForRebuild(
  db: Db,
  input: { afterId: string | null; limit: number },
): Promise<CaseForRebuild[]> {
  return db
    .select({
      id: cases.id,
      environmentId: cases.environmentId,
      caseTemplateId: cases.caseTemplateId,
      fieldSchemas: caseTemplateVersions.fieldSchemas,
    })
    .from(cases)
    .innerJoin(
      caseTemplateVersions,
      and(
        eq(caseTemplateVersions.environmentId, cases.environmentId),
        eq(caseTemplateVersions.id, cases.caseTemplateVersionId),
      ),
    )
    .where(
      and(
        isNull(cases.redactedAt),
        input.afterId === null ? undefined : gt(cases.id, input.afterId),
      ),
    )
    .orderBy(asc(cases.id))
    .limit(input.limit);
}
