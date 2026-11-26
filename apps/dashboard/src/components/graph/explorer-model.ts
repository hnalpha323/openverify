/**
 * The explorer's model of one or more stored results (C108). A result's nodes are accounts (by
 * their id) and shared values (by a `gn_` id local to that result, P17), so each node remembers
 * the query it came from: its unmask goes to that query. Merging an expansion keeps every node
 * already shown where it is and adds the rest, never past the node limit of 2,000.
 */
import { GRAPH_LIMITS, type GraphKind, type GraphQueryResource } from '@openverify/contracts';
import type { GraphNodeType } from './graph-words';

export interface ExplorerNode {
  readonly id: string;
  readonly type: GraphNodeType;
  readonly queryId: string;
}

export interface ExplorerLink {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphKind;
  readonly queryId: string;
}

export interface ExplorerGraph {
  readonly nodes: readonly ExplorerNode[];
  readonly links: readonly ExplorerLink[];
}

export interface AccountRow {
  readonly id: string;
  /** The kinds of the values it shares, in the order the result lists them. */
  readonly kinds: readonly GraphKind[];
  /** The accounts it shares a value with, in the order the result lists them. */
  readonly linked: readonly string[];
}

export interface ValueRow {
  readonly id: string;
  readonly type: GraphKind;
  readonly queryId: string;
  readonly holders: readonly string[];
}

export interface MergedGraph {
  readonly graph: ExplorerGraph;
  /** Nodes the addition brought. */
  readonly added: number;
  /** Nodes left out to stay within the node limit. */
  readonly cut: number;
}

/** A stored result as the explorer draws it. */
export function graphOfResult(query: GraphQueryResource): ExplorerGraph {
  const { nodes, links } = query.attributes;
  return {
    nodes: nodes.map((node) => ({ id: node.value, type: node.type, queryId: query.id })),
    links: links.map((link) => ({ ...link, queryId: query.id })),
  };
}

const isAccount = (node: ExplorerNode) => node.type === 'account';

/** The values each node is linked to, and the nodes each value links. */
function neighbours(graph: ExplorerGraph): Map<string, string[]> {
  const around = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = around.get(from) ?? [];
    if (!list.includes(to)) {
      list.push(to);
    }
    around.set(from, list);
  };
  for (const link of graph.links) {
    add(link.from, link.to);
    add(link.to, link.from);
  }
  return around;
}

/** One row per account: the kinds it is linked through and the accounts it shares them with. */
export function accountRows(graph: ExplorerGraph): AccountRow[] {
  const around = neighbours(graph);
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const sorted = (ids: Iterable<string>) =>
    [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return graph.nodes.filter(isAccount).map((account) => {
    const values = sorted(around.get(account.id) ?? []).flatMap((id) => {
      const node = byId.get(id);
      return node === undefined || isAccount(node) ? [] : [node];
    });
    const kinds = [...new Set(values.map((value) => value.type as GraphKind))];
    const linked = new Set<string>();
    for (const value of values) {
      for (const holder of around.get(value.id) ?? []) {
        if (holder !== account.id && byId.get(holder)?.type === 'account') {
          linked.add(holder);
        }
      }
    }
    return { id: account.id, kinds, linked: sorted(linked) };
  });
}

/** One row per shared value: its kind, its query and the accounts that hold it. */
export function valueRows(graph: ExplorerGraph): ValueRow[] {
  const around = neighbours(graph);
  const accounts = new Set(graph.nodes.filter(isAccount).map((node) => node.id));
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  return graph.nodes
    .filter((node) => !isAccount(node))
    .map((node) => ({
      id: node.id,
      type: node.type as GraphKind,
      queryId: node.queryId,
      holders: (around.get(node.id) ?? [])
        .filter((id) => accounts.has(id))
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    }));
}

/**
 * `base` with what `addition` brings: an account already shown stays once and where it is, every
 * new node is added after the others, until the node limit; a link is kept only between nodes
 * that are shown.
 */
export function mergeGraphs(
  base: ExplorerGraph,
  addition: ExplorerGraph,
  limit: number = GRAPH_LIMITS.nodeLimit,
): MergedGraph {
  const shown = new Set(base.nodes.map((node) => node.id));
  const nodes = [...base.nodes];
  let added = 0;
  let cut = 0;
  for (const node of addition.nodes) {
    if (shown.has(node.id)) {
      continue;
    }
    if (nodes.length >= limit) {
      cut += 1;
      continue;
    }
    nodes.push(node);
    shown.add(node.id);
    added += 1;
  }
  const seen = new Set(base.links.map((link) => `${link.from}|${link.to}|${link.kind}`));
  const links = [...base.links];
  for (const link of addition.links) {
    const key = `${link.from}|${link.to}|${link.kind}`;
    if (shown.has(link.from) && shown.has(link.to) && !seen.has(key)) {
      links.push(link);
      seen.add(key);
    }
  }
  return { graph: { nodes, links }, added, cut };
}

/** An account that shares a value directly with another, and the kinds of what they share. */
export interface DirectConnection {
  readonly id: string;
  readonly kinds: readonly GraphKind[];
}

/** The accounts that share a value directly with `accountId` in `graph`, in its order. */
export function directConnections(graph: ExplorerGraph, accountId: string): DirectConnection[] {
  const values = new Map(valueRows(graph).map((row) => [row.id, row]));
  const held = valueRows(graph).filter((row) => row.holders.includes(accountId));
  const kinds = new Map<string, GraphKind[]>();
  for (const value of held) {
    for (const holder of values.get(value.id)?.holders ?? []) {
      if (holder === accountId) {
        continue;
      }
      const list = kinds.get(holder) ?? [];
      if (!list.includes(value.type)) {
        list.push(value.type);
      }
      kinds.set(holder, list);
    }
  }
  return graph.nodes
    .filter((node) => kinds.has(node.id))
    .map((node) => ({ id: node.id, kinds: kinds.get(node.id) ?? [] }));
}
