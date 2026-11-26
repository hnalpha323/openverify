'use client';

import type { GraphQueryResource } from '@openverify/contracts';
import { GRAPH_PERSON_KINDS } from '@openverify/core';
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { CASES_REPORTS_COPY } from '../../lib/copy/cases-reports';
import { LINK_CLASS } from '../link-styles';
import { PageSection } from '../lifecycle/page-section';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import { BulkActions, type BulkActionsProps } from './bulk-actions';
import { graphOfResult, mergeGraphs, type ExplorerGraph, type ValueRow } from './explorer-model';
import { GraphCanvas } from './graph-canvas';
import { GraphTable } from './graph-table';
import { GRAPH_STATUS_WORDS, describeGraphProblem } from './graph-words';
import type { UnmaskAction } from './unmask-button';

export interface GraphExplorerProps {
  readonly query: GraphQueryResource;
  readonly piiView: boolean;
  /** The template an expansion runs with `account_id` bound; `null` when none may. */
  readonly expansionTemplateId: string | null;
  /** Why no expansion is offered, when `expansionTemplateId` is `null`. */
  readonly expansionReason?: string;
  /** Which bulk actions the role's scopes allow. */
  readonly bulk: BulkActionsProps['abilities'];
  readonly lists?: BulkActionsProps['lists'];
  /** C140.6: the case templates and queues of `create-case`. */
  readonly caseTemplates?: BulkActionsProps['caseTemplates'];
  readonly caseQueues?: BulkActionsProps['caseQueues'];
  readonly actions: {
    readonly unmask: UnmaskAction;
    readonly bulk: BulkActionsProps['action'];
    readonly expand: (
      state: ActionState<GraphQueryResource>,
      formData: FormData,
    ) => Promise<ActionResult<GraphQueryResource>>;
    /**
     * Owner decision 20 after Workflow 7B: expands a property node of a stored result
     * (`graph:write`); absent when the role may not.
     */
    readonly expandNode?: (
      state: ActionState<GraphQueryResource>,
      formData: FormData,
    ) => Promise<ActionResult<GraphQueryResource>>;
  };
  /** `pii:view`, which expanding a person-identifying kind needs beside `graph:write`. */
  readonly personExpand?: boolean;
}

type View = 'table' | 'canvas';

interface Expanded {
  readonly query: GraphQueryResource;
  readonly accountId: string;
}

interface Expansion {
  /** The account expanded around, or the property node expanded. */
  readonly accountId: string;
  readonly node?: boolean;
  readonly query: GraphQueryResource;
  readonly added: number;
  readonly cut: number;
}

const DEFAULT_EXPANSION_REASON =
  'This query’s template has no account_id parameter, so expanding around an account is not offered.';

const nodes = (count: number) => `${String(count)} ${count === 1 ? 'node' : 'nodes'}`;

/** What an expansion brought, in words. */
function expansionSentence(expansion: Expansion): string {
  const { accountId, query, added, cut } = expansion;
  const status = query.attributes.status;
  return [
    expansion.node === true
      ? `Expanded ${accountId}: ${nodes(added)} added.`
      : `Expanded around ${accountId}: ${nodes(added)} added.`,
    ...(cut > 0
      ? [`${nodes(cut)} left out to stay within the explorer’s limit of 2,000 nodes.`]
      : []),
    ...(status === 'completed' ? [] : [GRAPH_STATUS_WORDS[status].description]),
  ].join(' ');
}

/**
 * The graph explorer (C108): one stored result as a table (the default, for keyboard and
 * screen-reader users) or a canvas, with one selection shared by both and by the bulk actions.
 * Expanding around an account is an explicit action that runs the template with `account_id`
 * bound and merges the new result in place, within 2,000 nodes (owner decision 20 after Workflow
 * 7B); a shared value is never expanded around. Bulk actions act on the page's stored result.
 */
export function GraphExplorer({
  query,
  piiView,
  expansionTemplateId,
  expansionReason = DEFAULT_EXPANSION_REASON,
  bulk,
  lists,
  caseTemplates,
  caseQueues,
  actions,
  personExpand = false,
}: GraphExplorerProps) {
  const [view, setView] = useState<View>('table');
  const [graph, setGraph] = useState<ExplorerGraph>(() => graphOfResult(query));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expansions, setExpansions] = useState<readonly Expansion[]>([]);
  const [expanding, setExpanding] = useState<string | null>(null);
  // The action's callbacks may see an earlier render: this holds what the latest one drew.
  const drawn = useRef(graph);
  const expandAround = async (
    _state: ActionState<Expanded>,
    formData: FormData,
  ): Promise<ActionResult<Expanded>> => {
    const result = await actions.expand(null, formData);
    return result.ok
      ? { ok: true, data: { query: result.data, accountId: formData.get('account-id') as string } }
      : result;
  };
  const expand = useFormAction(expandAround, {
    onSuccess: ({ query: result, accountId }) => {
      const merged = mergeGraphs(drawn.current, graphOfResult(result));
      drawn.current = merged.graph;
      setGraph(merged.graph);
      setExpansions((list) => [
        ...list,
        {
          accountId,
          query: result,
          added: merged.added,
          cut: merged.cut,
        },
      ]);
      setExpanding(null);
    },
    onProblem: () => {
      setExpanding(null);
    },
  });

  // Owner decision 20 after Workflow 7B: a property node, expanded only when pressed.
  const expandNodeAction = actions.expandNode;
  const expandValue = useFormAction(
    async (_state: ActionState<Expanded>, formData: FormData): Promise<ActionResult<Expanded>> => {
      if (expandNodeAction === undefined) {
        return { ok: false, problem: { title: 'Expanding a value is not offered.' } };
      }
      const result = await expandNodeAction(null, formData);
      return result.ok
        ? { ok: true, data: { query: result.data, accountId: formData.get('node-id') as string } }
        : result;
    },
    {
      onSuccess: ({ query: result, accountId: nodeId }) => {
        const merged = mergeGraphs(drawn.current, graphOfResult(result));
        drawn.current = merged.graph;
        setGraph(merged.graph);
        setExpansions((list) => [
          ...list,
          { accountId: nodeId, node: true, query: result, added: merged.added, cut: merged.cut },
        ]);
        setExpanding(null);
      },
      onProblem: () => {
        setExpanding(null);
      },
    },
  );
  const valueExpansion =
    expandNodeAction === undefined
      ? undefined
      : {
          onExpand: (row: ValueRow) => {
            const data = new FormData();
            data.set('graph-query-id', row.queryId);
            data.set('node-id', row.id);
            setExpanding(row.id);
            expandValue.submit(data);
          },
          whyNot: (row: ValueRow) =>
            !personExpand && GRAPH_PERSON_KINDS.includes(row.type)
              ? CASES_REPORTS_COPY.graphExpand.needsPiiView
              : null,
        };

  const hasResult =
    query.attributes.status !== 'submitted' && query.attributes['redacted-at'] === null;
  const accountCount = query.relationships.accounts.data.length;
  const kinds = [
    ...new Set(
      query.attributes.nodes.filter((node) => node.type !== 'account').map((node) => node.type),
    ),
  ];
  const onExpand =
    expansionTemplateId === null
      ? undefined
      : (accountId: string) => {
          const data = new FormData();
          data.set('graph-query-template-id', expansionTemplateId);
          data.set('account-id', accountId);
          setExpanding(accountId);
          expand.submit(data);
        };

  return (
    <div className="flex flex-col gap-8">
      <PageSection id="graph-result" title="Result">
        <div className="flex flex-wrap gap-2" role="group" aria-label="View">
          {(['table', 'canvas'] as const).map((each) => (
            <Button
              key={each}
              variant={view === each ? 'primary' : 'secondary'}
              aria-pressed={view === each}
              onClick={() => {
                setView(each);
              }}
            >
              {each === 'table' ? 'Table view' : 'Canvas view'}
            </Button>
          ))}
        </div>
        {expansionTemplateId === null && (
          <p className="text-sm text-ink-muted">{expansionReason}</p>
        )}
        <ProblemDisplay
          problem={expand.problem === undefined ? undefined : describeGraphProblem(expand.problem)}
        />
        <ProblemDisplay problem={expandValue.problem} />
        {expansions.length > 0 && (
          <ul aria-label="Expansions" className="flex flex-col gap-1 text-sm">
            {expansions.map((expansion) => (
              <li key={expansion.query.id}>
                <span>{expansionSentence(expansion)}</span>{' '}
                {/* WCAG 2.5.3: the link's name is its visible text. */}
                <Link href={`/graph/${expansion.query.id}`} className={LINK_CLASS}>
                  {`Open ${expansion.query.id} in the explorer`}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {view === 'table' ? (
          <GraphTable
            graph={graph}
            selected={selected}
            onSelectionChange={setSelected}
            piiView={piiView}
            unmask={actions.unmask}
            expanding={expanding}
            {...(onExpand === undefined ? {} : { onExpand })}
            {...(valueExpansion === undefined ? {} : { valueExpansion })}
          />
        ) : (
          <GraphCanvas graph={graph} selected={selected} onSelectionChange={setSelected} />
        )}
      </PageSection>

      {hasResult && (
        <PageSection
          id="graph-bulk-actions"
          title="Bulk actions"
          description="Act on accounts of this stored result, selected in either view. Accounts that only an expansion added are not in it, and the preview leaves them out."
        >
          <BulkActions
            queryId={query.id}
            accountCount={accountCount}
            selected={selected}
            abilities={bulk}
            kinds={kinds}
            {...(lists === undefined ? {} : { lists })}
            {...(caseTemplates === undefined ? {} : { caseTemplates })}
            {...(caseQueues === undefined ? {} : { caseQueues })}
            action={actions.bulk}
          />
        </PageSection>
      )}
    </div>
  );
}
