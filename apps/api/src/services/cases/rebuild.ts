/**
 * C136.4 (P25; Workflow 8B Stage 4): `rebuildCaseFieldKeys`, which `blind-index:rebuild` calls after
 * the transaction field keys. It recomputes the `case_field_keys` rows of every unredacted case from
 * its sealed fields and the `searchable` fields of its pinned version, under the case field label,
 * so a key change does not leave a `fields.*` search answering nothing. Each case is rewritten under
 * its row lock, so a concurrent write or redaction waits; one whose keys are current is left alone,
 * so a second run updates nothing. It logs nothing; the script prints the counts.
 */
import type { FieldSchema } from '@openverify/core';
import {
  listCaseFieldKeys,
  listCasesForRebuild,
  lockCaseRow,
  replaceCaseFieldKeys,
  type Db,
  type RebuildIndexesResult,
} from '@openverify/db';
import { caseSearchableKeys } from './fields.js';

export interface RebuildCaseFieldKeysOptions {
  batchSize: number;
}

export type RebuildCaseFieldKeys = (
  db: Db,
  key: Uint8Array,
  options: RebuildCaseFieldKeysOptions,
) => Promise<RebuildIndexesResult>;

type Keyed = readonly { fieldKey: string; valueKey: string }[];

const ordered = (keys: Keyed) =>
  JSON.stringify(
    [...keys].sort((left, right) =>
      left.fieldKey === right.fieldKey
        ? left.valueKey.localeCompare(right.valueKey)
        : left.fieldKey.localeCompare(right.fieldKey),
    ),
  );

export const rebuildCaseFieldKeys: RebuildCaseFieldKeys = async (db, key, { batchSize }) => {
  let afterId: string | null = null;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const page = await listCasesForRebuild(db, { afterId, limit: batchSize });
    for (const row of page) {
      scanned += 1;
      const changed = await db.transaction(async (tx) => {
        const locked = await lockCaseRow(tx, row.environmentId, row.id);
        if (locked?.redactedAt !== null) {
          return false;
        }
        const keys = caseSearchableKeys(
          key,
          row.environmentId,
          row.caseTemplateId,
          row.fieldSchemas as readonly FieldSchema[],
          locked.fields,
        );
        if (ordered(keys) === ordered(await listCaseFieldKeys(tx, row.environmentId, row.id))) {
          return false;
        }
        await replaceCaseFieldKeys(tx, row.environmentId, row.id, keys);
        return true;
      });
      if (changed) {
        updated += 1;
      }
    }
    const last = page.at(-1);
    if (page.length < batchSize || last === undefined) {
      return { scanned, updated };
    }
    afterId = last.id;
  }
};
