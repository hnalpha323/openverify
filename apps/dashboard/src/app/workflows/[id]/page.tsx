import { idSchema } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable } from '../../../components/data-table';
import { Detail } from '../../../components/detail';
import { PageSection } from '../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../components/link-styles';
import { EmptyValue } from '../../../components/masked-value';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { Timestamp } from '../../../components/timestamp';
import { ManualRunForm } from '../../../components/workflows/manual-runs';
import { RunFilterForm, runFiltersOf } from '../../../components/workflows/run-filters';
import { TriggerDeliveriesTable } from '../../../components/workflows/trigger-deliveries-table';
import { EgressWords, GrantWords } from '../../../components/workflows/version-marks';
import {
  CancelOlderRunsButton,
  PromoteButton,
} from '../../../components/workflows/workflow-operations';
import {
  PublishDraftButton,
  RestoreVersionButton,
  RolloutActions,
} from '../../../components/workflows/workflow-publish';
import {
  WorkflowStatusActions,
  type WorkflowStatusAction,
} from '../../../components/workflows/workflow-status-actions';
import {
  WORKFLOW_PAUSED_REASON_WORDS,
  WORKFLOW_RUN_WAITING_ON_WORDS,
  WORKFLOW_STATUS_WORDS,
  WORKFLOW_TRIGGER_TYPE_WORDS,
  WORKFLOW_VERSION_STATUS_WORDS,
  runStatusWords,
  wordOf,
} from '../../../components/workflows/workflow-words';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import {
  cancelOlderRuns,
  changeRollout,
  promoteWorkflow,
  publishWorkflow,
  restoreVersion,
  setWorkflowStatus,
  startManualRuns,
} from '../actions';

export const metadata: Metadata = { title: 'Workflow' };

/** Versions, runs and deliveries shown at once, newest first, each list paged on its own. */
const PAGE_SIZE = 50;

/** Each list's cursor parameter, so paging one keeps the others' place (C1, 8C amendment 13). */
const CURSOR_PARAMS = {
  versions: 'versions-after',
  runs: 'runs-after',
  deliveries: 'deliveries-after',
} as const;

export interface WorkflowPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

function statusActionsOf(status: string): WorkflowStatusAction[] {
  if (status === 'running') {
    return ['pause'];
  }
  return status === 'paused' ? ['activate', 'archive'] : [];
}

/**
 * One workflow (C141.5, C141.6): its status in words with the paused reason's banner (C121.5),
 * the version history with each version's warnings (`publisher_scope_lost` among them, Phase 8A
 * amendment 60), its runs (`workflow-runs:read`), filtered by step errors, and pause, activate and
 * archive with `workflows:write`.
 */
export default async function WorkflowPage({ params, searchParams }: WorkflowPageProps) {
  const { id } = await params;
  if (!idSchema('wfl').safeParse(id).success) {
    notFound();
  }
  const query = await searchParams;
  const filters = runFiltersOf(query);
  const stepErrors = filters.stepErrors;
  const versionsAfter = parseCursor(query[CURSOR_PARAMS.versions], 'wfv');
  const runsAfter = parseCursor(query[CURSOR_PARAMS.runs], 'wfr');
  const deliveriesAfter = parseCursor(query[CURSOR_PARAMS.deliveries], 'wftd');
  const pageOf = (after: string | undefined) => ({
    size: PAGE_SIZE,
    ...(after === undefined ? {} : { after }),
  });
  return renderPage({ permissions: ['workflows:read'] }, async ({ session, api }) => {
    const can = (permission: Permission) => hasPermission(session, permission);
    const [{ data: workflow }, versions, runs, deliveries] = await Promise.all([
      api.workflows.retrieve(id),
      api.workflowVersions.list({ filter: { 'workflow-id': id }, page: pageOf(versionsAfter) }),
      can('workflow-runs:read')
        ? api.workflowRuns.list({
            filter: {
              'workflow-id': [id],
              ...(filters.status === undefined ? {} : { status: [filters.status] }),
              ...(filters.versionId === undefined
                ? {}
                : { 'workflow-version-id': [filters.versionId] }),
              ...(filters.subjectId === undefined ? {} : { 'subject-id': filters.subjectId }),
              ...(stepErrors ? { 'has-step-errors': 'true' } : {}),
            },
            page: pageOf(runsAfter),
          })
        : Promise.resolve(null),
      can('workflow-runs:read')
        ? api.workflowRuns.deliveries({
            filter: { 'workflow-id': [id] },
            page: pageOf(deliveriesAfter),
          })
        : Promise.resolve(null),
    ]);
    const path = `/workflows/${id}`;
    // The query every list's links keep: the run filters and each list's own cursor.
    const kept = {
      ...filters.query,
      [CURSOR_PARAMS.versions]: versionsAfter,
      [CURSOR_PARAMS.runs]: runsAfter,
      [CURSOR_PARAMS.deliveries]: deliveriesAfter,
    };
    const without = (param: string) => ({ ...kept, [param]: undefined });
    const published = versions.data
      .filter((version) => version.attributes.status === 'published')
      .map((version) => ({ id: version.id, number: version.attributes['version-number'] }));
    const versionChoices = versions.data.map((version) => ({
      id: version.id,
      number: version.attributes['version-number'],
    }));
    // C116.2: a cancel names a version and reaches the runs of every version older than it. The
    // list never holds archived versions, so any published version after the first may have older
    // ones whose runs are still unfinished; version 1 has none before it.
    const cancelChoices = published.filter((version) => version.number > 1);
    const promoteTargets = session.environments.filter(
      (environment) => environment.id !== session.environment.id,
    );
    const { attributes } = workflow;
    const reason = attributes['paused-reason'];
    const actions = can('workflows:write') ? statusActionsOf(attributes.status) : [];
    const hasDraft = workflow.relationships['draft-version'].data !== null;
    const rollingOut = workflow.relationships['active-deployment'].data !== null;
    const rolloutVersion = versions.data.find(
      (version) => version.attributes['rollout-percentage'] !== null,
    );
    const hasLive = workflow.relationships['latest-published-version'].data !== null;
    // C112.2: promote is user-only under workflows:publish, of a live version, never in a rollout.
    const canPromote =
      can('workflows:publish') && hasLive && !rollingOut && promoteTargets.length > 0;
    const canCancelRuns = can('workflow-runs:write') && cancelChoices.length > 0;
    // C120.7: test runs are for sandbox environments; C118.5: manual runs start the live version.
    const canTest = can('workflows:trigger') && session.environment.kind === 'sandbox';
    const canRunManually = can('workflows:trigger') && hasLive;
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Workflows', href: '/workflows' }, { label: code(workflow.id) }]}
          title={attributes.name}
          description={attributes.description ?? undefined}
          actions={
            actions.length > 0 ? (
              <WorkflowStatusActions
                workflowId={workflow.id}
                actions={actions}
                action={setWorkflowStatus}
              />
            ) : undefined
          }
        />
        {reason !== null && (
          <Alert
            tone={reason === 'publisher_revoked' ? 'warning' : 'info'}
            title="Paused"
            aria-label="Paused"
          >
            {wordOf(WORKFLOW_PAUSED_REASON_WORDS, reason)}.
          </Alert>
        )}
        {(can('workflows:write') || (hasDraft && can('workflows:publish'))) && (
          <div role="group" aria-label="Authoring" className="flex flex-wrap items-center gap-3">
            {can('workflows:write') && (
              <Link href={`/workflows/${workflow.id}/draft`} className={LINK_CLASS}>
                {hasDraft ? 'Open the draft' : 'New draft'}
              </Link>
            )}
            {hasDraft && can('workflows:publish') && (
              <PublishDraftButton workflowId={workflow.id} action={publishWorkflow} />
            )}
          </div>
        )}
        {(canPromote || canCancelRuns || canTest) && (
          <div role="group" aria-label="Operations" className="flex flex-wrap items-center gap-3">
            {canTest && (
              <Link href={`/workflows/${workflow.id}/test-runs`} className={LINK_CLASS}>
                Test run
              </Link>
            )}
            {canPromote && (
              <PromoteButton
                workflowId={workflow.id}
                targets={promoteTargets}
                action={promoteWorkflow}
              />
            )}
            {canCancelRuns && (
              <CancelOlderRunsButton
                workflowId={workflow.id}
                versions={cancelChoices}
                action={cancelOlderRuns}
              />
            )}
          </div>
        )}
        {rollingOut && (
          <PageSection id="workflow-rollout" title="Rollout">
            <RolloutActions
              workflowId={workflow.id}
              percentage={rolloutVersion?.attributes['rollout-percentage'] ?? null}
              action={can('workflows:publish') ? changeRollout : undefined}
            />
          </PageSection>
        )}
        <PageSection id="workflow-details" title="Details">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Status">{wordOf(WORKFLOW_STATUS_WORDS, attributes.status)}</Detail>
            <Detail term="Kind">{attributes.kind === 'module' ? 'Module' : 'Workflow'}</Detail>
            <Detail term="Live version">
              {workflow.relationships['latest-published-version'].data === null
                ? 'Not published yet'
                : code(workflow.relationships['latest-published-version'].data.id)}
            </Detail>
            <Detail term="Draft">
              {workflow.relationships['draft-version'].data === null
                ? 'No draft'
                : code(workflow.relationships['draft-version'].data.id)}
            </Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
        </PageSection>
        <PageSection id="workflow-versions" title="Version history">
          <DataTable
            caption="Version history"
            captionHidden
            rows={versions.data}
            getRowKey={(version) => version.id}
            emptyMessage="No version yet."
            columns={[
              {
                id: 'number',
                header: 'Version',
                rowHeader: true,
                cell: (version) => String(version.attributes['version-number']),
              },
              {
                id: 'status',
                header: 'Status',
                cell: (version) =>
                  `${wordOf(WORKFLOW_VERSION_STATUS_WORDS, version.attributes.status)}${version.attributes.live ? ' (live)' : ''}`,
              },
              {
                id: 'trigger',
                header: 'Trigger',
                cell: (version) =>
                  version.attributes['trigger-type'] === null
                    ? 'No trigger yet'
                    : wordOf(WORKFLOW_TRIGGER_TYPE_WORDS, version.attributes['trigger-type']),
              },
              {
                id: 'published',
                header: 'Published (UTC)',
                cell: (version) =>
                  version.attributes['published-at'] === null ? (
                    <EmptyValue />
                  ) : (
                    <Timestamp value={version.attributes['published-at']} />
                  ),
              },
              {
                id: 'grant',
                header: 'Grant',
                cell: (version) => <GrantWords grant={version.attributes.grant} />,
              },
              {
                id: 'egress',
                header: 'Personal data leaving',
                cell: (version) => <EgressWords egress={version.attributes.egress} />,
              },
              {
                id: 'warnings',
                header: 'Warnings',
                cell: (version) =>
                  version.attributes.warnings.length === 0
                    ? 'None'
                    : version.attributes.warnings.map((warning) => warning.code).join(', '),
              },
              ...(can('workflows:publish')
                ? [
                    {
                      id: 'restore',
                      header: 'Restore',
                      cell: (version: (typeof versions.data)[number]) =>
                        version.attributes.status === 'published' && !version.attributes.live ? (
                          <RestoreVersionButton
                            workflowId={workflow.id}
                            versionId={version.id}
                            versionNumber={version.attributes['version-number']}
                            action={restoreVersion}
                          />
                        ) : (
                          'None'
                        ),
                    },
                  ]
                : []),
            ]}
          />
          <Pagination
            path={path}
            query={without(CURSOR_PARAMS.versions)}
            after={versionsAfter}
            nextCursor={cursorFromNextLink(versions.links.next, 'wfv')}
            param={CURSOR_PARAMS.versions}
            label="Version pages"
          />
        </PageSection>
        {canRunManually && (
          <PageSection id="workflow-manual-runs" title="Manual runs">
            <ManualRunForm workflowId={workflow.id} action={startManualRuns} />
          </PageSection>
        )}
        {deliveries !== null && (
          <PageSection id="workflow-deliveries" title="Trigger deliveries">
            <TriggerDeliveriesTable deliveries={deliveries.data} />
            <Pagination
              path={path}
              query={without(CURSOR_PARAMS.deliveries)}
              after={deliveriesAfter}
              nextCursor={cursorFromNextLink(deliveries.links.next, 'wftd')}
              param={CURSOR_PARAMS.deliveries}
              label="Delivery pages"
            />
          </PageSection>
        )}
        {runs !== null && (
          <PageSection id="workflow-runs" title="Runs">
            <RunFilterForm path={path} filters={filters} versions={versionChoices} />
            <DataTable
              caption="Runs of this workflow"
              captionHidden
              rows={runs.data}
              getRowKey={(run) => run.id}
              emptyMessage={
                Object.keys(filters.query).length > 0
                  ? 'No run matches these filters.'
                  : 'No run yet.'
              }
              columns={[
                {
                  id: 'run',
                  header: 'Run',
                  rowHeader: true,
                  cell: (run) => (
                    <Link href={`/workflows/runs/${run.id}`} className={LINK_CLASS}>
                      {code(run.id)}
                    </Link>
                  ),
                },
                {
                  id: 'status',
                  header: 'Status',
                  cell: (run) =>
                    runStatusWords(run.attributes.status, run.attributes['step-outcomes']),
                },
                {
                  id: 'waiting',
                  header: 'Waiting on',
                  cell: (run) =>
                    run.attributes['waiting-on'] === null
                      ? 'Nothing'
                      : wordOf(WORKFLOW_RUN_WAITING_ON_WORDS, run.attributes['waiting-on']),
                },
                {
                  id: 'version',
                  header: 'Version',
                  cell: (run) => code(run.relationships['workflow-version'].data.id),
                },
                {
                  id: 'rollout',
                  header: 'Rollout',
                  cell: (run) => run.attributes['rollout-label'] ?? 'None',
                },
                {
                  id: 'created',
                  header: 'Created (UTC)',
                  cell: (run) => <Timestamp value={run.attributes['created-at']} />,
                },
              ]}
            />
            <Pagination
              path={path}
              query={without(CURSOR_PARAMS.runs)}
              after={runsAfter}
              nextCursor={cursorFromNextLink(runs.links.next, 'wfr')}
              param={CURSOR_PARAMS.runs}
              label="Run pages"
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
