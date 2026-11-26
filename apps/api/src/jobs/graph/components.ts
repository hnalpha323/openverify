/**
 * C101.6 (Workflow 7B; ours, H, `beta`, advisory): the nightly `graph-components` job. For each
 * environment with `graph-components` on, union-find over the strong kinds only (never a weak one:
 * IP links alone merge everything, nor a medium one), written to `graph_components` with its
 * `computed_at`; every account of the environment gets a row, a size of 1 when it shares nothing,
 * so "not computed yet" means newer than the run. The component id is the run's own label. Owner:
 * `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signature.
 */
import { GRAPH_STRONG_KINDS, graphKindCode } from '@openverify/core';
import {
  getEnvironment,
  listGraphAttributesPage,
  listGraphBackfillAccounts,
  listGraphEnvironmentIds,
  replaceGraphComponents,
  type Db,
} from '@openverify/db';
import type { Clock } from '../../ports.js';
import { graphSettingsOf } from '../../services/graph/settings.js';
import type { WorkerLogger } from '../logger.js';

export interface GraphComponentsDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
}

export type RunGraphComponents = (deps: GraphComponentsDeps) => Promise<void>;

const PAGE = 5000;

/** Union-find with path halving and union by size. */
class Components {
  private readonly parent = new Map<string, string>();
  private readonly size = new Map<string, number>();

  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.size.set(id, 1);
    }
  }

  find(id: string): string {
    let node = id;
    for (;;) {
      const parent = this.parent.get(node) ?? node;
      if (parent === node) {
        return node;
      }
      const grand = this.parent.get(parent) ?? parent;
      this.parent.set(node, grand);
      node = grand;
    }
  }

  union(a: string, b: string): void {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) {
      return;
    }
    if ((this.size.get(rootA) ?? 1) < (this.size.get(rootB) ?? 1)) {
      [rootA, rootB] = [rootB, rootA];
    }
    this.parent.set(rootB, rootA);
    this.size.set(rootA, (this.size.get(rootA) ?? 1) + (this.size.get(rootB) ?? 1));
  }

  rows(): { accountId: string; componentId: string; size: number }[] {
    const labels = new Map<string, string>();
    return [...this.parent.keys()].map((accountId) => {
      const root = this.find(accountId);
      let label = labels.get(root);
      if (label === undefined) {
        label = `c${String(labels.size + 1)}`;
        labels.set(root, label);
      }
      return { accountId, componentId: label, size: this.size.get(root) ?? 1 };
    });
  }
}

const STRONG_CODES = GRAPH_STRONG_KINDS.map(graphKindCode);

async function componentsOf(db: Db, environmentId: string): Promise<Components> {
  const components = new Components();
  for (let after: string | null = null; ;) {
    const ids = await listGraphBackfillAccounts(db, environmentId, { after, limit: PAGE });
    ids.forEach((id) => {
      components.add(id);
    });
    if (ids.length < PAGE) {
      break;
    }
    after = ids.at(-1) ?? null;
  }
  let holder: { kind: number; valueKey: string; accountId: string } | null = null;
  for (let after: { kind: number; valueKey: string; accountId: string } | null = null; ;) {
    const rows = await listGraphAttributesPage(db, environmentId, {
      kinds: STRONG_CODES,
      after,
      limit: PAGE,
    });
    for (const row of rows) {
      components.add(row.accountId);
      if (holder !== null && holder.kind === row.kind && holder.valueKey === row.valueKey) {
        components.union(holder.accountId, row.accountId);
      } else {
        holder = row;
      }
    }
    if (rows.length < PAGE) {
      break;
    }
    after = rows.at(-1) ?? null;
  }
  return components;
}

export const runGraphComponents: RunGraphComponents = async ({ db, clock, logger }) => {
  for (const environmentId of await listGraphEnvironmentIds(db)) {
    const environment = await getEnvironment(db, environmentId);
    if (environment === null || !graphSettingsOf(environment).components) {
      continue;
    }
    const rows = (await componentsOf(db, environmentId)).rows();
    const at = clock.now();
    await db.transaction((tx) => replaceGraphComponents(tx, environmentId, rows, at));
    logger.info({ environmentId, accounts: rows.length }, 'graph components computed');
  }
};
