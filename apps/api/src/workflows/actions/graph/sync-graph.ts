/**
 * C127.5, outcome 26: Sync Graph: a claimed step that polls the account's inquiries'
 * `graph_index_jobs` and `graph_index_state`, and reuses `kindsNotIndexedFor`. `synced: true` only when
 * nothing is pending and every kind its mode covers is indexed. A job skipped with
 * `graph_indexing_off` reads as its kinds not indexed; one errored is `graph_index_failed`, because
 * waiting cannot change it. Past the timeout: `synced: false`, or `graph_index_pending` by default.
 */
import type { GraphQueryTemplateConfig } from '@openverify/contracts';
import {
  GRAPH_KINDS,
  GRAPH_KIND_REGISTRY,
  graphKindOfCode,
  type GraphKind,
} from '@openverify/core';
import {
  getAccount,
  listAccountGraphIndexJobs,
  listCurrentGraphQueryTemplateVersions,
  type Db,
} from '@openverify/db';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  syncGraphConfigSchema,
  GRAPH_ACTION_LIMITS,
  type SyncGraphConfig,
} from '@openverify/workflow-engine/actions';
import { kindsNotIndexedFor } from '../../../services/graph/queries.js';
import type {
  ActionContext,
  ActionResult,
  OutsideActionHandler,
} from '../../engine/action-port.js';
import { answering, apiDepsOf, configOf } from '../shared.js';

const POLL_MS = GRAPH_ACTION_LIMITS['sync-poll-seconds'].value * 1_000;
const MARGIN = GRAPH_ACTION_LIMITS['sync-lease-margin-seconds'].value;

const configFor = (kinds: readonly GraphKind[], includeWeak: boolean) =>
  ({
    'connect-kinds': [...kinds],
    'include-weak-kinds': includeWeak,
    start: [],
    parameters: [],
  }) as unknown as GraphQueryTemplateConfig;

/**
 * The kinds a mode covers. No kind here is an embedding, so `non-embedding` is every kind but the
 * opt-in ones (weak kinds and device recognition), and `all` asks for those too.
 */
async function coveredConfigs(
  db: Db,
  environmentId: string,
  config: SyncGraphConfig,
): Promise<readonly GraphQueryTemplateConfig[]> {
  if (config.mode === 'selective') {
    const ids = config['graph-query-template-ids'] ?? [];
    const versions = await listCurrentGraphQueryTemplateVersions(db, environmentId, ids);
    return ids.flatMap((id) => {
      const published = versions.get(id)?.published;
      return published == null ? [] : [published.config as GraphQueryTemplateConfig];
    });
  }
  if (config.mode === 'all') {
    return [configFor(GRAPH_KINDS, true)];
  }
  const standing = GRAPH_KINDS.filter((kind) => !GRAPH_KIND_REGISTRY[kind].needsDeviceRecognition);
  return [configFor(standing, false)];
}

interface SyncState {
  pending: number;
  failed: boolean;
  skippedOff: boolean;
  missing: readonly string[];
}

async function stateOf(
  db: Db,
  environmentId: string,
  accountId: string,
  configs: readonly GraphQueryTemplateConfig[],
): Promise<SyncState> {
  const jobs = await listAccountGraphIndexJobs(db, environmentId, accountId);
  const missing = new Set<string>();
  for (const config of configs) {
    for (const code of await kindsNotIndexedFor(db, environmentId, config)) {
      const kind = graphKindOfCode(code);
      if (kind !== null) {
        missing.add(kind);
      }
    }
  }
  return {
    pending: jobs.filter(({ status }) => status === 'pending').length,
    failed: jobs.some(({ status }) => status === 'errored'),
    skippedOff: jobs.some(
      ({ status, lastErrorCode }) => status === 'skipped' && lastErrorCode === 'graph_indexing_off',
    ),
    missing: [...missing],
  };
}

const covered = (configs: readonly GraphQueryTemplateConfig[]): string[] => [
  ...new Set(configs.flatMap((config) => config['connect-kinds'])),
];

async function poll(
  context: ActionContext,
  config: SyncGraphConfig,
  configs: readonly GraphQueryTemplateConfig[],
): Promise<ActionResult> {
  const { db } = apiDepsOf(context);
  const { environmentId } = context;
  const deadline = Date.now() + config['timeout-seconds'] * 1_000;
  for (;;) {
    const state = await stateOf(db, environmentId, config['account-id'], configs);
    if (state.failed) {
      return { kind: 'failed', code: 'graph_index_failed' };
    }
    if (state.pending === 0 && state.missing.length === 0 && !state.skippedOff) {
      return { kind: 'succeeded', output: { synced: true, mode: config.mode } };
    }
    const left = deadline - Date.now();
    if (left <= 0 || context.signal.aborted) {
      if (config['on-pending'] === 'error') {
        return { kind: 'failed', code: 'graph_index_pending' };
      }
      return {
        kind: 'succeeded',
        output: {
          synced: false,
          'pending-jobs': state.pending,
          'kinds-not-indexed': state.skippedOff ? covered(configs) : [...state.missing],
        },
      };
    }
    await sleep(Math.min(POLL_MS, left));
  }
}

export const SYNC_GRAPH_HANDLER: OutsideActionHandler = {
  key: 'sync_graph',
  version: 1,
  shape: 'outside',
  leaseSeconds: (config) => Number(config['timeout-seconds'] ?? 60) + MARGIN,
  execute: (context) =>
    answering(async () => {
      const config = configOf(context, syncGraphConfigSchema);
      const { db } = apiDepsOf(context);
      const { environmentId } = context;
      if ((await getAccount(db, environmentId, config['account-id'])) === null) {
        return { kind: 'failed', code: 'object_not_found' };
      }
      return poll(context, config, await coveredConfigs(db, environmentId, config));
    }),
};
