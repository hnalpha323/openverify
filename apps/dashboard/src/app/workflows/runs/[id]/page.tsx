import { idSchema, type WorkflowRunResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable } from '../../../../components/data-table';
import { Detail } from '../../../../components/detail';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../../components/link-styles';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { Timestamp } from '../../../../components/timestamp';
import { loadSection } from '../../../../components/lifecycle/section-data';
import { StageBadge } from '../../../../components/reports/report-badges';
import { EvidenceMeta } from '../../../../components/signals/evidence';
import {
  pathListOf,
  runPathOf,
  statusBadgeOf,
  structureOf,
} from '../../../../components/workflows/editor/canvas-model';
import { readDraft } from '../../../../components/workflows/editor/document-model';
import { RunPathCanvas } from '../../../../components/workflows/editor/run-path-canvas';
import { RunActions, type RunControl } from '../../../../components/workflows/run-actions';
import { RunValue, type RunValueFacts } from '../../../../components/workflows/run-values';
import {
  WORKFLOW_ERROR_TYPE_WORDS,
  WORKFLOW_RUN_CREATOR_WORDS,
  WORKFLOW_RUN_WAITING_ON_WORDS,
  WORKFLOW_STEP_STATUS_WORDS,
  WORKFLOW_TRIGGER_TYPE_WORDS,
  runStatusWords,
  stepErrorWords,
  wordOf,
} from '../../../../components/workflows/workflow-words';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { controlRun, redactRun } from '../../actions';

export const metadata: Metadata = { title: 'Workflow run' };

/** Steps shown per run: one page holds every step of most runs. */
const STEP_PAGE_SIZE = 100;

export interface WorkflowRunPageProps {
  readonly params: Promise<{ id: string }>;
}

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

function creatorOf(creator: WorkflowRunResource['relationships']['creator']['data']) {
  if (creator === null) {
    return 'A recurring schedule (no creator)';
  }
  return (
    <>
      {wordOf(WORKFLOW_RUN_CREATOR_WORDS, creator.type)} {code(creator.id)}
    </>
  );
}

/** C120.3 to C120.5: what each status allows. */
function controlsOf(status: WorkflowRunResource['attributes']['status']): RunControl[] {
  switch (status) {
    case 'in_progress':
      return ['cancel'];
    case 'errored':
      return ['resume', 'rerun'];
    default:
      return ['rerun'];
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * C122.1 (H10), C141.9: an H-tier step's matches as the API served them, each with its method,
 * tier, stage and confidence, as the Phase 6 report views show them; nothing when masked.
 */
function MatchEvidence({ output }: { readonly output: unknown }) {
  const matches = isRecord(output) && Array.isArray(output.matches) ? output.matches : [];
  const shown = matches.filter(isRecord);
  if (shown.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Matches with their tier" className="mt-1 flex flex-col gap-1 text-xs">
      {shown.map((match, index) => (
        <li
          key={typeof match.id === 'string' ? match.id : String(index)}
          className="flex flex-wrap gap-1.5"
        >
          <span>{typeof match.method === 'string' ? match.method : 'Match'}</span>
          <EvidenceMeta
            tier={typeof match.tier === 'string' ? match.tier : 'unknown'}
            beta={match.stage === 'beta'}
            confidence={typeof match.confidence === 'number' ? match.confidence : null}
          />
          {match.approximate === true && <span>approximate</span>}
        </li>
      ))}
    </ul>
  );
}

const EFFECT_WORDS: Readonly<Record<string, string>> = {
  claimed: 'Effect claimed',
  done: 'Effect made',
  unknown: 'Outcome unknown',
};

/**
 * One run (C120, C141.6): its status in words with its step errors, what it waits on, its error
 * type and step, its steps with attempts, and its values as the API masked them (fail closed for a
 * reader without PII visibility, C120.6). Reads `GET /workflow-runs/:id` and its steps with
 * `workflow-runs:read`.
 */
export default async function WorkflowRunPage({ params }: WorkflowRunPageProps) {
  const { id } = await params;
  if (!idSchema('wfr').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['workflow-runs:read'] }, async ({ session, api }) => {
    const [{ data: run }, steps] = await Promise.all([
      api.workflowRuns.retrieve(id),
      api.workflowRuns.steps(id, { page: { size: STEP_PAGE_SIZE } }),
    ]);
    const { attributes, relationships } = run;
    // C141.6: the version's graph for the path, and the catalogue for each action's stage, read
    // with workflows:read; a definition holds configuration only, and only its structure is sent.
    const graph = await loadSection(hasPermission(session, 'workflows:read'), () =>
      Promise.all([
        api.workflowVersions.retrieve(relationships['workflow-version'].data.id),
        api.workflows.actions(),
      ]),
    );
    const read =
      graph.kind === 'ready' ? readDraft(graph.data[0].data.attributes.definition) : null;
    const structure = read === null ? null : structureOf(read);
    const stages = new Map(
      graph.kind === 'ready'
        ? graph.data[1].data.map(({ attributes: action }) => [action.key, action.stage] as const)
        : [],
    );
    const path =
      structure === null
        ? null
        : runPathOf(
            structure,
            steps.data.map((step) => ({
              nodeId: step.attributes['node-id'],
              iterationPath: step.attributes['iteration-path'],
              status: step.attributes.status,
            })),
          );
    const countable =
      structure?.steps.filter((step) => step.type !== 'output' && step.type !== 'join') ?? [];
    const reached = countable.filter((step) => path?.statuses[step.id] !== undefined).length;
    const facts: RunValueFacts = {
      redactedAt: attributes['redacted-at'],
      valuesPurgedAt: attributes['values-purged-at'],
    };
    const workflowId = relationships.workflow.data.id;
    const error = attributes.error;
    const controls = hasPermission(session, 'workflow-runs:write')
      ? controlsOf(attributes.status)
      : [];
    const redact =
      hasPermission(session, 'workflow-runs:redact') && attributes['redacted-at'] === null
        ? redactRun
        : undefined;
    const erroredStep = attributes['errored-step'];
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Workflows', href: '/workflows' }, { label: code(run.id) }]}
          title={<>Run {code(run.id)}</>}
          description={runStatusWords(attributes.status, attributes['step-outcomes'])}
          actions={
            controls.length > 0 || redact !== undefined ? (
              <RunActions
                runId={run.id}
                controls={controls}
                unknownEffects={attributes['step-outcomes']['unknown-effect']}
                control={controlRun}
                redact={redact}
              />
            ) : undefined
          }
        />
        <PageSection id="run-details" title="Details">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Detail term="Status">
              {runStatusWords(attributes.status, attributes['step-outcomes'])}
            </Detail>
            {attributes['waiting-on'] !== null && (
              <Detail term="Waiting on">
                {wordOf(WORKFLOW_RUN_WAITING_ON_WORDS, attributes['waiting-on'])}
              </Detail>
            )}
            {error !== null && (
              <Detail term="Error">
                {error.type}: {wordOf(WORKFLOW_ERROR_TYPE_WORDS, error.type)}
              </Detail>
            )}
            {erroredStep !== null && (
              <Detail term="Errored step">
                {erroredStep.name} ({erroredStep.key})
              </Detail>
            )}
            <Detail term="Workflow">
              <Link href={`/workflows/${workflowId}`} className={LINK_CLASS}>
                {code(workflowId)}
              </Link>
            </Detail>
            <Detail term="Version">{code(relationships['workflow-version'].data.id)}</Detail>
            <Detail term="Trigger">
              {wordOf(WORKFLOW_TRIGGER_TYPE_WORDS, attributes['trigger-type'])}
            </Detail>
            <Detail term="Started by">{creatorOf(relationships.creator.data)}</Detail>
            <Detail term="Rollout">{attributes['rollout-label'] ?? 'No rollout'}</Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term="Ended (UTC)">
              {attributes['completed-at'] === null ? (
                'Not yet'
              ) : (
                <Timestamp value={attributes['completed-at']} />
              )}
            </Detail>
            <Detail term="Subjects">
              {attributes['subject-ids'].length === 0
                ? 'None recorded'
                : attributes['subject-ids'].map((subject) => (
                    <span key={subject} className="mr-2">
                      {code(subject)}
                    </span>
                  ))}
            </Detail>
            {attributes['test-run-id'] !== null && <Detail term="Test run">Yes</Detail>}
          </dl>
        </PageSection>
        <PageSection id="run-path" title="Path taken">
          {structure === null || path === null ? (
            <p className="text-sm">
              {graph.kind === 'hidden'
                ? 'Drawing the path needs workflows:read, to read the version’s definition.'
                : graph.kind === 'forbidden'
                  ? 'You do not have access to the version’s definition, so the path is not drawn.'
                  : 'The version’s definition cannot be drawn; the steps below are the path.'}
            </p>
          ) : (
            <>
              <p className="text-sm">
                The run reached {String(reached)} of {String(countable.length)} steps. The list and
                the canvas show each status as an icon and a word; a step the run did not reach
                reads “Not reached”.
              </p>
              <ol aria-label="Path taken as a list" className="flex flex-col gap-1 text-sm">
                {pathListOf(structure, path).map((item) => (
                  <li key={item.id}>
                    {item.label}: <span aria-hidden="true">{item.badge.icon}</span>{' '}
                    {item.badge.word}
                  </li>
                ))}
              </ol>
              <RunPathCanvas definition={structure} path={path} />
            </>
          )}
        </PageSection>
        <PageSection id="run-steps" title="Steps">
          <DataTable
            caption="Steps of this run"
            captionHidden
            rows={steps.data}
            getRowKey={(step) => step.id}
            emptyMessage="No step has run yet."
            columns={[
              {
                id: 'step',
                header: 'Step',
                rowHeader: true,
                cell: (step) => (
                  <>
                    {code(step.attributes['node-id'])}
                    {step.attributes['iteration-path'] !== '' && (
                      <> in {code(step.attributes['iteration-path'])}</>
                    )}
                  </>
                ),
              },
              {
                id: 'action',
                header: 'Action',
                cell: (step) => {
                  const key = step.attributes['action-key'];
                  return key === null ? (
                    step.attributes['node-type']
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {key}
                      {stages.get(key) === 'beta' && <StageBadge stage="beta" />}
                    </span>
                  );
                },
              },
              {
                id: 'status',
                header: 'Status',
                cell: (step) => (
                  <>
                    <span aria-hidden="true">{statusBadgeOf(step.attributes.status).icon}</span>{' '}
                    {wordOf(WORKFLOW_STEP_STATUS_WORDS, step.attributes.status)}
                  </>
                ),
              },
              {
                id: 'attempts',
                header: 'Attempts',
                cell: (step) => String(step.attributes.attempt),
              },
              {
                id: 'error',
                header: 'Error',
                cell: (step) =>
                  step.attributes['error-type'] === null
                    ? 'None'
                    : `${step.attributes['error-type']}${step.attributes['error-code'] === null ? '' : ` (${step.attributes['error-code']}): ${stepErrorWords(step.attributes['error-code'])}`}`,
              },
              {
                id: 'effect',
                header: 'Effect',
                cell: (step) =>
                  step.attributes['effect-status'] === null
                    ? 'No effect'
                    : wordOf(EFFECT_WORDS, step.attributes['effect-status']),
              },
              {
                id: 'output',
                header: 'Output',
                cell: (step) => (
                  <>
                    <RunValue value={step.attributes.output} facts={facts} />
                    <MatchEvidence output={step.attributes.output} />
                  </>
                ),
              },
            ]}
          />
        </PageSection>
        <PageSection id="run-values" title="Values">
          <dl className="grid grid-cols-1 gap-4">
            <Detail term="Inputs">
              <RunValue value={attributes.inputs} facts={facts} />
            </Detail>
            <Detail term="Variables">
              <RunValue value={attributes.variables} facts={facts} />
            </Detail>
            <Detail term="Outputs">
              <RunValue value={attributes.outputs} facts={facts} />
            </Detail>
            <Detail term="Trigger snapshot">
              <RunValue value={attributes['trigger-snapshot']} facts={facts} />
            </Detail>
          </dl>
        </PageSection>
      </PageMain>
    );
  });
}
