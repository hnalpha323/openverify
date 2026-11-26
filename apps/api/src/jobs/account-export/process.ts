/**
 * C253.2 (Workflow 11B Stage 1b (D)): the `account-export` job's processor, which cuts one access
 * export's manifest (the collector, the 5,000-item bound, the sealed manifest in storage, the export
 * `ready` or `failed`).
 *
 * Frozen by `foundation-11b`; built by `dsar-export` over `cutAccountExport`
 * (`services/account-export/cut.ts`) and the `account_exports` rows (`store.ts`): an export no longer
 * pending (deleted by a redaction, or cut already) is skipped.
 */
import type { Db, Keyring } from '@openverify/db';
import type { Clock, FileStorage } from '../../ports.js';
import { cutAccountExport } from '../../services/account-export/cut.js';
import { accountExportStores } from '../../services/account-export/store.js';
import type { AccountExportJob } from '../account-export-queues.js';
import type { WorkerLogger } from '../logger.js';

/** What the processor reads and writes. */
export interface AccountExportProcessDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  keyring: Keyring;
  storage: FileStorage;
}

/** What one job did. */
export interface AccountExportProcessResult {
  outcome: 'ready' | 'failed' | 'skipped';
}

export type ProcessAccountExport = (
  job: AccountExportJob,
  deps: AccountExportProcessDeps,
) => Promise<AccountExportProcessResult>;

/** C253.2: cuts the export (`dsar-export`'s). */
export const processAccountExport: ProcessAccountExport = async (job, deps) => {
  const cut = await cutAccountExport(
    { ...deps, store: accountExportStores },
    job.environmentId,
    job.exportId,
  );
  return { outcome: cut.outcome };
};
