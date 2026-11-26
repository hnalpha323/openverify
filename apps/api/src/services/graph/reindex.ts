/**
 * C101.5 (Workflow 7B): `pnpm --filter @openverify/api graph:reindex [--environment <env_…>]`
 * runs the backfill's walk on demand: every account and inquiry of the environment (or of every
 * environment), in bounded batches, each kind marked complete at the end. Counts only, never ids or
 * values. Owner: `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signature.
 */
import {
  completeGraphIndexStates,
  getEnvironment,
  listGraphEnvironmentIds,
  type Db,
} from '@openverify/db';
import { backfillStep, type GraphBackfillCursor } from '../../jobs/graph/backfill.js';
import { graphSettingsOf } from './settings.js';

export interface GraphReindexDeps {
  db: Db;
  blindIndexKey: Uint8Array;
}

export interface GraphReindexOptions {
  /** One environment; every environment when absent. */
  environmentId?: string | undefined;
  batchSize: number;
}

export interface GraphReindexResult {
  environments: number;
  accounts: number;
  inquiries: number;
  rows: number;
}

export type RunGraphReindex = (
  deps: GraphReindexDeps,
  options: GraphReindexOptions,
) => Promise<GraphReindexResult>;

export const runGraphReindex: RunGraphReindex = async ({ db, blindIndexKey }, options) => {
  const result: GraphReindexResult = { environments: 0, accounts: 0, inquiries: 0, rows: 0 };
  const environmentIds =
    options.environmentId === undefined
      ? await listGraphEnvironmentIds(db)
      : [options.environmentId];
  for (const environmentId of environmentIds) {
    const environment = await getEnvironment(db, environmentId);
    if (environment === null) {
      continue;
    }
    const settings = graphSettingsOf(environment);
    const at = new Date();
    let cursor: GraphBackfillCursor | null = { phase: 'accounts', after: null };
    while (cursor !== null) {
      const step = await backfillStep(db, blindIndexKey, settings, environmentId, cursor, {
        limit: options.batchSize,
        at,
      });
      result.accounts += step.accounts;
      result.inquiries += step.inquiries;
      result.rows += step.rows;
      cursor = step.next;
    }
    await completeGraphIndexStates(db, environmentId, new Date());
    result.environments += 1;
  }
  return result;
};
