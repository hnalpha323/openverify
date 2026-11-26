import { idSchema, type ListResource } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { GraphExplorer } from '../../../components/graph/graph-explorer';
import { GraphResultSummary } from '../../../components/graph/graph-result-summary';
import { PageSection } from '../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../components/link-styles';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { CASE_QUEUE_CHOICES, listCaseQueues } from '../../../lib/api/case-queues';
import { CASE_TEMPLATE_CHOICES, listCaseTemplates } from '../../../lib/api/case-templates';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import {
  cancelGraphQuery,
  expandAroundAccount,
  graphBulkAction,
  rerunGraphQuery,
  unmaskGraphNode,
} from '../actions';
import { expandPropertyNode } from './node-expand-actions';

export const metadata: Metadata = { title: 'Graph query' };

export interface GraphQueryPageProps {
  readonly params: Promise<{ id: string }>;
}

const NEEDS_WRITE = 'Expanding around an account needs graph:write, which your role does not hold.';
const NO_ACCOUNT_PARAMETER =
  'This query’s template has no account_id parameter, so expanding around an account is not offered.';

/** The list kind of a list resource's type, `list/<kind>`. */
const kindOf = (list: ListResource) => list.type.slice('list/'.length);

/**
 * One graph query's explorer (C108), at `/graph/<grphq id>`. The console builds every link here
 * from the query's id and never reads `explorer-url`, which is `null` without a configured console
 * URL (K7B-11). Reads the query and its pinned template version with `graph:read`; nothing runs on
 * render (the `graph-queries` policy allows 30 runs a minute per environment). The values stay
 * masked: the result carries none, and an unmask is an explicit, audited press offered only with
 * `pii:view`. Rerun and cancel need `graph:write`; each bulk action its own scopes beside
 * `graph:read`, which the page offers only to a role holding them.
 */
export default async function GraphQueryPage({ params }: GraphQueryPageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!idSchema('grphq').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['graph:read'] }, async ({ session, api }) => {
    const can = (permission: Permission) => hasPermission(session, permission);
    const { data: query } = await api.graphQueries.retrieve(id);
    const { data: version } = await api.graphQueryTemplates.versions.retrieve(
      query.attributes['template-version-id'],
    );
    const templateId = version.relationships['graph-query-template'].data.id;
    const { config } = version.attributes;
    const canList = can('lists:read') && can('lists:write') && can('pii:view');
    // C140.6: create-case needs cases:write, and case-templates:read to choose its template.
    const canCreateCase = can('cases:write') && can('case-templates:read');
    const [{ data: template }, lists, caseTemplates, caseQueues] = await Promise.all([
      api.graphQueryTemplates.retrieve(templateId),
      canList
        ? api.lists.list({ filter: { status: ['active'] }, page: { size: 100 } })
        : Promise.resolve(null),
      canCreateCase
        ? listCaseTemplates({ status: 'active', size: CASE_TEMPLATE_CHOICES })
        : Promise.resolve(null),
      canCreateCase && can('case-queues:read')
        ? listCaseQueues({ status: 'active' }, { size: CASE_QUEUE_CHOICES })
        : Promise.resolve(null),
    ]);
    const status = query.attributes.status;
    const write = can('graph:write');
    const bindsAccount = config.parameters.some((parameter) => parameter.kind === 'account_id');
    const showExplorer =
      query.attributes['redacted-at'] === null &&
      (status === 'completed' || status === 'timed_out' || query.attributes.nodes.length > 0);
    const piiView = can('pii:view');
    const fields = { 'graph-query-id': query.id };

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Graph', href: '/graph' }, { label: 'Query' }]}
          title="Graph query"
          description={
            <span className="flex flex-col gap-1">
              <code className="font-mono text-xs">{query.id}</code>
              <span>
                Template{' '}
                <Link href={`/graph/templates/${template.id}`} className={LINK_CLASS}>
                  {`${template.attributes.name}, version ${String(version.attributes['version-number'])}`}
                </Link>
              </span>
            </span>
          }
          actions={
            write ? (
              status === 'submitted' ? (
                <ConfirmActionButton
                  label="Cancel query"
                  title="Cancel this query?"
                  description="A submitted query that has not run yet stops here. One that has already finished cannot be cancelled."
                  confirmLabel="Cancel query"
                  pendingLabel="Cancelling…"
                  action={cancelGraphQuery}
                  fields={fields}
                  successMessage="The query was cancelled."
                />
              ) : (
                <ConfirmActionButton
                  label="Rerun"
                  variant="secondary"
                  tone="primary"
                  title="Run this query again?"
                  description="It runs the same template version with the same parameters, against the graph as it is now, and counts against the environment’s 30 runs a minute."
                  confirmLabel="Rerun"
                  pendingLabel="Running…"
                  action={rerunGraphQuery}
                  fields={fields}
                  successMessage="The query was run again."
                />
              )
            ) : undefined
          }
        />

        <PageSection id="graph-summary" title="Summary">
          <GraphResultSummary
            query={query}
            nodeLimit={config['node-limit'] ?? null}
            piiView={piiView}
          />
        </PageSection>

        {showExplorer && (
          <GraphExplorer
            query={query}
            piiView={piiView}
            expansionTemplateId={write && bindsAccount ? template.id : null}
            expansionReason={write ? NO_ACCOUNT_PARAMETER : NEEDS_WRITE}
            bulk={{
              tags: can('accounts:write'),
              lists: can('lists:write') && piiView,
              export: can('accounts:read') && piiView,
              cases: canCreateCase,
            }}
            {...(caseTemplates === null
              ? {}
              : {
                  // Only a published version takes a new case (C130.2).
                  caseTemplates: caseTemplates.data
                    .filter((each) => each.attributes['published-version'] !== null)
                    .map((each) => ({ id: each.id, name: each.attributes.name })),
                })}
            {...(caseQueues === null
              ? {}
              : {
                  caseQueues: caseQueues.data.map((each) => ({
                    id: each.id,
                    name: each.attributes.name,
                  })),
                })}
            {...(lists === null
              ? {}
              : {
                  lists: lists.data.map((list) => ({
                    id: list.id,
                    name: list.attributes.name,
                    kind: kindOf(list),
                  })),
                })}
            personExpand={piiView}
            actions={{
              unmask: unmaskGraphNode,
              bulk: graphBulkAction,
              expand: expandAroundAccount,
              // Owner decision 20 after Workflow 7B: a property node, with graph:write.
              ...(write ? { expandNode: expandPropertyNode } : {}),
            }}
          />
        )}
      </PageMain>
    );
  });
}
