/**
 * C102.3 (Workflow 7B; decision 35): the graph engine. A hop-by-hop breadth-first search with a
 * visited set, in one read-only transaction, with one parameterised statement per step of a hop
 * (`kind = any($1::smallint[])`, `account_id = any($2)`): an account's values, the values'
 * holders, the holders the template's filters keep. No SQL, Cypher or expression text ever comes
 * from a caller. Not a recursive CTE: the research measured one repeating 3.7-7x the work at depths
 * 3 and 4.
 *
 * - **Hops** are counted the public way: an account and its value are one hop apart, so two
 *   accounts sharing a value are two (C102.2). A start value is hop 0, its holders hop 1.
 * - **Limits.** Each statement runs under `SET LOCAL statement_timeout` within the query's deadline;
 *   past it the run answers what it gathered, `timedOut`. A value whose capped holder count
 *   exceeds the fan-out cap (F24, `limit cap + 1`) is skipped and counted. The search stops at
 *   `node-limit` (accounts and values together) with `nodeLimitReached`.
 * - **Nodes.** An account node carries its id; a property node a random id local to the result
 *   (`gn_` + 22 base64url characters, P17), mapped to its kind and value key in `nodeMap` on the
 *   server only. A value joins the result when at least two of the result's accounts hold it (a
 *   value only one account holds links nothing), and a start value always does.
 * - **Claims.** `claim` runs first in the transaction: an advisory lock on the template for an
 *   asynchronous run, one of two per-environment slots for a synchronous one (C102.4, P25).
 */
import { randomBytes } from 'node:crypto';
import type { GraphLink, GraphNode, GraphQueryTemplateConfig } from '@openverify/contracts';
import {
  GRAPH_KIND_REGISTRY,
  GRAPH_LIMITS,
  graphKindCode,
  graphKindOfCode,
  type GraphKind,
} from '@openverify/core';
import {
  filterGraphAccounts,
  listAccountGraphAttributes,
  listGraphValueHoldersOf,
  type Db,
  type GraphAccountFilters,
} from '@openverify/db';
import { sql, type SQL } from 'drizzle-orm';

/** A start value, bound and keyed by the API. */
export interface GraphStartValue {
  nodeId: string;
  kind: GraphKind;
  valueKey: string;
  keyId: string;
  /** The parameter it came from, so its unmask answers what the searcher gave. */
  parameter: string;
}

/** What `node_map` holds per node id: never a value (P17). */
export type GraphNodeMapEntry =
  | {
      kind: number;
      valueKey: string;
      keyId?: string | undefined;
      start?: true | undefined;
      parameter?: string | undefined;
    }
  | { start: true; account: true };

export interface GraphSearchPlan {
  environmentId: string;
  config: GraphQueryTemplateConfig;
  startAccounts: readonly string[];
  startValues: readonly GraphStartValue[];
  filters: GraphAccountFilters;
  /** The fan-out cap (F24); `GRAPH_LIMITS.defaultFanOut` by default. */
  fanOut?: number | undefined;
  /** Epoch milliseconds. */
  deadline: number;
}

export interface GraphSearchResult {
  nodes: GraphNode[];
  links: GraphLink[];
  nodeMap: Record<string, GraphNodeMapEntry>;
  accountIds: string[];
  skippedHubValues: number;
  nodeLimitReached: boolean;
  timedOut: boolean;
}

/** A claim run first in the search's transaction; `false` leaves the search unrun. */
export type GraphClaim = (tx: Db) => Promise<boolean>;

/** A new property node id: random, never derived from a value or a key (P17). */
export const newGraphNodeId = (): string => `gn_${randomBytes(16).toString('base64url')}`;

/** The start of a stored query: its node map's start entries, as the API bound them. */
export function startOf(nodeMap: Readonly<Record<string, unknown>>): {
  startAccounts: string[];
  startValues: GraphStartValue[];
} {
  const startAccounts: string[] = [];
  const startValues: GraphStartValue[] = [];
  for (const [nodeId, raw] of Object.entries(nodeMap)) {
    const entry = raw as Partial<{
      start: boolean;
      account: boolean;
      kind: number;
      valueKey: string;
      keyId: string;
      parameter: string;
    }>;
    if (entry.start !== true) {
      continue;
    }
    if (entry.account === true) {
      startAccounts.push(nodeId);
      continue;
    }
    const kind = typeof entry.kind === 'number' ? graphKindOfCode(entry.kind) : null;
    if (kind !== null && typeof entry.valueKey === 'string') {
      startValues.push({
        nodeId,
        kind,
        valueKey: entry.valueKey,
        keyId: entry.keyId ?? '',
        parameter: entry.parameter ?? '',
      });
    }
  }
  return { startAccounts, startValues };
}

class DeadlinePassed extends Error {
  override name = 'DeadlinePassed';
}

/** SQLSTATE `query_canceled`: the statement timeout fired. */
const QUERY_CANCELED = '57014';

function isTimeout(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof DeadlinePassed) {
      return true;
    }
    if ((current as { code?: unknown }).code === QUERY_CANCELED) {
      return true;
    }
  }
  return false;
}

class Search {
  readonly nodes: GraphNode[] = [];
  readonly links: GraphLink[] = [];
  readonly nodeMap: Record<string, GraphNodeMapEntry> = {};
  /** Account id to its hop. */
  readonly accounts = new Map<string, number>();
  readonly visited = new Set<string>();
  skippedHubValues = 0;
  nodeLimitReached = false;

  constructor(private readonly limit: number) {}

  private room(): boolean {
    if (this.nodes.length >= this.limit) {
      this.nodeLimitReached = true;
      return false;
    }
    return true;
  }

  addAccount(id: string, hop: number): boolean {
    if (this.accounts.has(id)) {
      return true;
    }
    if (!this.room()) {
      return false;
    }
    this.accounts.set(id, hop);
    this.nodes.push({ type: 'account', value: id });
    return true;
  }

  addValue(kind: GraphKind, entry: GraphNodeMapEntry, nodeId = newGraphNodeId()): string | null {
    if (!this.room()) {
      return null;
    }
    this.nodes.push({ type: kind, value: nodeId });
    this.nodeMap[nodeId] = entry;
    return nodeId;
  }

  link(accountId: string, nodeId: string, kind: GraphKind): void {
    this.links.push({ from: accountId, to: nodeId, kind });
  }
}

const valueOf = (kind: number, valueKey: string) => `${String(kind)}|${valueKey}`;

/**
 * Runs the search. `null` when `claim` refused; otherwise the result, `timedOut` with what was
 * gathered when the deadline passed.
 */
export async function searchGraph(
  db: Db,
  plan: GraphSearchPlan,
  options: { now: () => number; claim?: GraphClaim | undefined },
): Promise<GraphSearchResult | null> {
  const { config, environmentId } = plan;
  const maxHops = config['max-hops'] ?? GRAPH_LIMITS.defaultMaxHops;
  const fanOut = Math.min(plan.fanOut ?? GRAPH_LIMITS.defaultFanOut, GRAPH_LIMITS.fanOut);
  const weak = config['include-weak-kinds'] === true;
  const kinds = config['connect-kinds']
    .filter((kind) => weak || GRAPH_KIND_REGISTRY[kind].strength !== 'weak')
    .map(graphKindCode);
  const search = new Search(config['node-limit'] ?? GRAPH_LIMITS.defaultNodeLimit);
  const run = { claimed: true };
  let timedOut = false;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      if (options.claim !== undefined && !(await options.claim(tx))) {
        run.claimed = false;
        return;
      }
      const timed = async <T>(run: () => Promise<T>): Promise<T> => {
        const remaining = Math.floor(plan.deadline - options.now());
        if (remaining <= 0) {
          throw new DeadlinePassed('the deadline passed');
        }
        await tx.execute(sql.raw(`set local statement_timeout = ${String(remaining)}`));
        return run();
      };

      for (const id of await timed(() =>
        filterGraphAccounts(tx, environmentId, plan.startAccounts, {}),
      )) {
        if (!search.addAccount(id, 0)) {
          return;
        }
      }
      // A start value is hop 0; its holders are hop 1.
      const starts = new Map<string, string>();
      for (const start of plan.startValues) {
        const code = graphKindCode(start.kind);
        search.visited.add(valueOf(code, start.valueKey));
        const nodeId = search.addValue(
          start.kind,
          {
            kind: code,
            valueKey: start.valueKey,
            keyId: start.keyId,
            start: true,
            parameter: start.parameter,
          },
          start.nodeId,
        );
        if (nodeId === null) {
          return;
        }
        starts.set(valueOf(code, start.valueKey), nodeId);
      }
      if (maxHops >= 1 && plan.startValues.length > 0) {
        const holders = await timed(() =>
          listGraphValueHoldersOf(tx, environmentId, {
            values: plan.startValues.map((start) => ({
              kind: graphKindCode(start.kind),
              valueKey: start.valueKey,
            })),
            cap: fanOut,
          }),
        );
        const candidates = holders
          .filter(({ accountIds }) => accountIds.length <= fanOut)
          .flatMap(({ accountIds }) => accountIds)
          .filter((id) => !search.accounts.has(id));
        const admitted = new Set(
          await timed(() =>
            filterGraphAccounts(tx, environmentId, [...new Set(candidates)], plan.filters),
          ),
        );
        for (const { kind, valueKey, accountIds } of holders) {
          if (accountIds.length > fanOut) {
            search.skippedHubValues += 1;
            continue;
          }
          const nodeId = starts.get(valueOf(kind, valueKey)) ?? '';
          const name = graphKindOfCode(kind);
          for (const accountId of accountIds) {
            if (search.accounts.has(accountId) || admitted.has(accountId)) {
              if (!search.addAccount(accountId, 1)) {
                return;
              }
              if (name !== null) {
                search.link(accountId, nodeId, name);
              }
            }
          }
        }
      }

      let frontier = [...search.accounts].filter(([, hop]) => hop + 2 <= maxHops);
      while (frontier.length > 0 && kinds.length > 0) {
        const hopOf = new Map(frontier);
        const rows = await timed(() =>
          listAccountGraphAttributes(tx, environmentId, {
            accountIds: frontier.map(([id]) => id),
            kinds,
          }),
        );
        // Each new value, with the hop it is reached at (its nearest frontier holder + 1).
        const fresh = new Map<string, { kind: number; valueKey: string; hop: number }>();
        for (const row of rows) {
          const key = valueOf(row.kind, row.valueKey);
          if (search.visited.has(key)) {
            continue;
          }
          const hop = (hopOf.get(row.accountId) ?? 0) + 1;
          const seen = fresh.get(key);
          if (seen === undefined || hop < seen.hop) {
            fresh.set(key, { kind: row.kind, valueKey: row.valueKey, hop });
          }
        }
        for (const key of fresh.keys()) {
          search.visited.add(key);
        }
        const values = [...fresh.values()];
        const holders = await timed(() =>
          listGraphValueHoldersOf(tx, environmentId, { values, cap: fanOut }),
        );
        const candidates = holders
          .filter(({ accountIds }) => accountIds.length <= fanOut)
          .flatMap(({ accountIds }) => accountIds)
          .filter((id) => !search.accounts.has(id));
        const admitted = new Set(
          await timed(() =>
            filterGraphAccounts(tx, environmentId, [...new Set(candidates)], plan.filters),
          ),
        );
        const added: [string, number][] = [];
        for (const { kind, valueKey, accountIds } of holders) {
          if (accountIds.length > fanOut) {
            search.skippedHubValues += 1;
            continue;
          }
          const name = graphKindOfCode(kind);
          const hop = fresh.get(valueOf(kind, valueKey))?.hop ?? 1;
          const kept = accountIds.filter((id) => search.accounts.has(id) || admitted.has(id));
          if (name === null || kept.length < 2) {
            continue;
          }
          const nodeId = search.addValue(name, { kind, valueKey });
          if (nodeId === null) {
            return;
          }
          for (const accountId of kept) {
            if (!search.accounts.has(accountId)) {
              if (!search.addAccount(accountId, hop + 1)) {
                return;
              }
              added.push([accountId, hop + 1]);
            }
            search.link(accountId, nodeId, name);
          }
        }
        frontier = added.filter(([, hop]) => hop + 2 <= maxHops);
      }
    });
  } catch (error) {
    if (!isTimeout(error)) {
      throw error;
    }
    timedOut = true;
  }
  if (!run.claimed) {
    return null;
  }
  return {
    nodes: search.nodes,
    links: search.links,
    nodeMap: search.nodeMap,
    accountIds: [...search.accounts.keys()],
    skippedHubValues: search.skippedHubValues,
    nodeLimitReached: search.nodeLimitReached,
    timedOut,
  };
}

async function claimedBy(tx: Db, statement: SQL): Promise<boolean> {
  const result: unknown = await tx.execute(statement);
  const rows = (result as { rows?: { claimed?: unknown }[] }).rows ?? [];
  return rows[0]?.claimed === true;
}

/** C102.4: the advisory claim of an asynchronous run: one running query per template (F40). */
export function templateClaim(environmentId: string, templateId: string): GraphClaim {
  return async (tx) => {
    return claimedBy(
      tx,
      sql`select pg_try_advisory_xact_lock(
        hashtextextended(${`openverify/graph-query/${environmentId}${templateId}`}, 0)) as claimed`,
    );
  };
}

/** C102.4 (P25): one of the environment's synchronous slots (`syncPerEnvironment`, 2). */
export function synchronousClaim(environmentId: string): GraphClaim {
  return async (tx) => {
    for (let slot = 0; slot < GRAPH_LIMITS.syncPerEnvironment; slot += 1) {
      const claimed = await claimedBy(
        tx,
        sql`select pg_try_advisory_xact_lock(
          hashtextextended(${`openverify/graph-query-sync/${environmentId}/${String(slot)}`}, 0))
          as claimed`,
      );
      if (claimed) {
        return true;
      }
    }
    return false;
  };
}
