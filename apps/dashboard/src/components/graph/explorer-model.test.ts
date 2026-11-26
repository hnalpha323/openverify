import { GRAPH_LIMITS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  GRAPH_IDS as IDS,
  NODE_IDS,
  chainQuery,
  graphNodeId,
  graphQuery,
} from '../../testing/graph-fixtures';
import { accountRows, graphOfResult, mergeGraphs, valueRows } from './explorer-model';

describe('the explorer model (C108)', () => {
  it('reads a stored result as nodes and links, each tagged with the query it came from', () => {
    const graph = graphOfResult(graphQuery());
    expect(graph.nodes).toEqual([
      { id: IDS.accountA, type: 'account', queryId: IDS.query },
      { id: NODE_IDS.email, type: 'email_address', queryId: IDS.query },
      { id: IDS.accountB, type: 'account', queryId: IDS.query },
      { id: NODE_IDS.phone, type: 'phone_number_unconfirmed', queryId: IDS.query },
      { id: IDS.accountC, type: 'account', queryId: IDS.query },
    ]);
    expect(graph.links).toHaveLength(4);
    expect(graph.links[0]).toEqual({
      from: IDS.accountA,
      to: NODE_IDS.email,
      kind: 'email_address',
      queryId: IDS.query,
    });
  });

  it('lists each account with the kinds it is linked through and the accounts it shares them with', () => {
    expect(accountRows(graphOfResult(graphQuery()))).toEqual([
      { id: IDS.accountA, kinds: ['email_address'], linked: [IDS.accountB] },
      {
        id: IDS.accountB,
        kinds: ['email_address', 'phone_number_unconfirmed'],
        linked: [IDS.accountA, IDS.accountC],
      },
      { id: IDS.accountC, kinds: ['phone_number_unconfirmed'], linked: [IDS.accountB] },
    ]);
  });

  it('lists each shared value with its kind, its query and the accounts that hold it', () => {
    expect(valueRows(graphOfResult(graphQuery()))).toEqual([
      {
        id: NODE_IDS.email,
        type: 'email_address',
        queryId: IDS.query,
        holders: [IDS.accountA, IDS.accountB],
      },
      {
        id: NODE_IDS.phone,
        type: 'phone_number_unconfirmed',
        queryId: IDS.query,
        holders: [IDS.accountB, IDS.accountC],
      },
    ]);
  });

  it('merges an expansion around an account: known accounts once, new elements added, the rest kept as they were', () => {
    const base = graphOfResult(graphQuery());
    const expansion = graphOfResult(
      graphQuery({
        id: IDS.expansion,
        nodes: [
          { type: 'account', value: IDS.accountC },
          { type: 'email_address', value: NODE_IDS.expandedEmail },
          { type: 'account', value: IDS.accountD },
        ],
        links: [
          { from: IDS.accountC, to: NODE_IDS.expandedEmail, kind: 'email_address' },
          { from: IDS.accountD, to: NODE_IDS.expandedEmail, kind: 'email_address' },
        ],
      }),
    );
    const merged = mergeGraphs(base, expansion);
    expect(merged.graph.nodes.slice(0, base.nodes.length)).toEqual(base.nodes);
    expect(merged.graph.nodes.slice(base.nodes.length)).toEqual([
      { id: NODE_IDS.expandedEmail, type: 'email_address', queryId: IDS.expansion },
      { id: IDS.accountD, type: 'account', queryId: IDS.expansion },
    ]);
    expect(merged.graph.links).toHaveLength(6);
    expect(merged).toMatchObject({ added: 2, cut: 0 });
  });

  it('never grows past the node limit of 2,000, and says how many it left out', () => {
    const base = graphOfResult(chainQuery(1000));
    expect(base.nodes).toHaveLength(1999);
    const extra = graphOfResult(
      graphQuery({
        id: IDS.expansion,
        nodes: [
          { type: 'account', value: IDS.accountA },
          { type: 'email_address', value: graphNodeId('extra') },
          { type: 'account', value: IDS.accountB },
        ],
        links: [
          { from: IDS.accountA, to: graphNodeId('extra'), kind: 'email_address' },
          { from: IDS.accountB, to: graphNodeId('extra'), kind: 'email_address' },
        ],
      }),
    );
    const merged = mergeGraphs(base, extra);
    expect(merged.graph.nodes).toHaveLength(GRAPH_LIMITS.nodeLimit);
    expect(merged).toMatchObject({ added: 1, cut: 2 });
    // A link is kept only between nodes that are shown.
    const shown = new Set(merged.graph.nodes.map((node) => node.id));
    expect(merged.graph.links.every((link) => shown.has(link.from) && shown.has(link.to))).toBe(
      true,
    );
  });
});
