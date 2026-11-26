/**
 * C253.4 (Workflow 11B Stage 1b (D)): the hooks through which an access export never outlives what
 * it lists. `foundation-11b` placed the calls; `dsar-export` builds the bodies (its file), over
 * `deletion.ts` and the `account_exports` repository.
 *
 * - `subjectRedactedInTx`: called first in the inquiry and account redaction cascades
 *   (`services/redaction.ts`), in the cascade's own transaction, with the redacted subject's id; it
 *   deletes every export of the environment that lists it and answers the manifests' object keys,
 *   which the cascade deletes after its commit with its other objects.
 * - `retention`: called first in the C16 pass (`services/retention.ts`); it expires the exports past
 *   `account-export-ttl-days` (and deletes their manifests) and answers its count for the report.
 *
 * Built over `deletion.ts` and `store.ts`. A pending export of a redacted account is deleted too (it
 * lists nothing yet, so it is matched by its account): its job then finds no row and skips. A
 * manifest object a storage failure keeps after the drain is ciphertext whose wrapped data key went
 * with its row (KP10-54's decision: no sweep of objects without rows).
 */
import type { Db } from '@openverify/db';
import type { FileStorage } from '../../ports.js';
import { deleteExportsListingInTx, runAccountExportRetention } from './deletion.js';
import { accountExportStores } from './store.js';

/** The C16 report's account-export member. */
export interface AccountExportRetentionReport {
  /** Exports expired this pass (their manifests deleted). */
  expiredAccountExports: number;
}

export interface AccountExportHooks {
  subjectRedactedInTx(
    tx: Db,
    input: { environmentId: string; itemIds: readonly string[]; at: Date },
  ): Promise<string[]>;
  retention(
    deps: { db: Db; storage: FileStorage },
    batch: { now: Date; limit: number },
  ): Promise<AccountExportRetentionReport>;
}

/** C253.4: the hooks' bodies (`dsar-export`'s). */
export const accountExportHooks: AccountExportHooks = {
  async subjectRedactedInTx(tx, { environmentId, itemIds }) {
    const deleted = await deleteExportsListingInTx(tx, accountExportStores, environmentId, itemIds);
    return deleted.flatMap(({ storageKey }) => (storageKey === null ? [] : [storageKey]));
  },
  async retention(deps, { now, limit }) {
    const { expired } = await runAccountExportRetention(deps, accountExportStores, now, limit);
    return { expiredAccountExports: expired };
  },
};
