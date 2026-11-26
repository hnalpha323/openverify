import {
  idSchema,
  workflowNodeIdSchema,
  type WorkflowActionResource,
  type WorkflowDefinition,
  type WorkflowRunStepResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../../components/link-styles';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { structureOf } from '../../../../components/workflows/editor/canvas-model';
import { readDraft } from '../../../../components/workflows/editor/document-model';
import { RunOverlay } from '../../../../components/workflows/overlay/run-overlay';
import { RecordedMessages } from '../../../../components/workflows/recorded-messages';
import { RunValue, type RunValueFacts } from '../../../../components/workflows/run-values';
import {
  TestRunForm,
  type TestRunAcknowledgement,
} from '../../../../components/workflows/test-run-form';
import {
  WORKFLOW_STEP_STATUS_WORDS,
  runStatusWords,
  wordOf,
} from '../../../../components/workflows/workflow-words';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { searchRecordedMessages, startTestRun } from '../../actions';

export const metadata: Metadata = { title: 'Test run' };

/** The URL of the test-run panel for a workflow, optionally on one step range (C120.7, C141.9). */
export interface TestRunPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A step id from the URL, or empty when it is not one. */
function stepParam(value: string | string[] | undefined): string {
  const text = single(value) ?? '';
  return workflowNodeIdSchema.safeParse(text).success ? text : '';
}

type Step = WorkflowDefinition['steps'][number];

const actionKeyOf = (step: Step): string | null =>
  step.type === 'action' ? (step as { 'action-key': string })['action-key'] : null;

/**
 * C116.4, C120.7: what each step needs before it runs for real in a test run. An irreversible
 * (redaction) or adverse step runs only with `irreversible:<step>`, otherwise it is simulated; an
 * egress step reaches a real host only with `egress:<step>` and the host named.
 */
function acknowledgementsOf(
  steps: readonly Step[],
  catalogue: readonly WorkflowActionResource[],
): TestRunAcknowledgement[] {
  const byKey = new Map(catalogue.map((row) => [row.attributes.key, row.attributes]));
  return steps.flatMap((step) => {
    const key = actionKeyOf(step);
    const entry = key === null ? undefined : byKey.get(key);
    if (entry === undefined) {
      return [];
    }
    const found: TestRunAcknowledgement[] = [];
    if (key === 'redact_object' || entry.adverse !== 'never') {
      found.push({
        key: `irreversible:${step.id}`,
        label: `Run ${step.id} for real (irreversible): it changes the subject and records a decision.`,
      });
    }
    if (entry.kind === 'egress') {
      found.push({
        key: `egress:${step.id}`,
        label: `${step.id} may send personal data to a host named above.`,
      });
    }
    return found;
  });
}

/** One started run's steps, with each output and console as the API served them. */
function TestRunResult({
  runId,
  status,
  steps,
  facts,
  focus,
}: {
  readonly runId: string;
  readonly status: string;
  readonly steps: readonly WorkflowRunStepResource[];
  readonly facts: RunValueFacts;
  readonly focus: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Run{' '}
        <Link href={`/workflows/runs/${runId}`} className={LINK_CLASS}>
          {code(runId)}
        </Link>
        : {status}.
      </p>
      <p className="text-sm">
        A step’s console lines are shown only to the test run’s creator, and only with pii:view.
      </p>
      {steps.length === 0 ? (
        <p className="text-sm">No step has run yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {steps
            .filter((step) => focus === null || step.attributes['node-id'] === focus)
            .map((step) => {
              const node = step.attributes['node-id'];
              const lines = step.attributes.console;
              return (
                <li key={step.id} className="flex flex-col gap-2">
                  <p className="text-sm font-semibold">
                    {code(node)}: {wordOf(WORKFLOW_STEP_STATUS_WORDS, step.attributes.status)}
                    {step.attributes.simulated ? ' (simulated: no change made)' : ''}
                    {step.attributes.overridden ? ' (output overridden)' : ''}
                  </p>
                  <p className="text-sm">Input</p>
                  <RunValue value={step.attributes.input} facts={facts} />
                  <p className="text-sm">Output</p>
                  <RunValue value={step.attributes.output} facts={facts} />
                  {lines === null ? (
                    <p className="text-sm">Console: Hidden without pii:view, or not recorded.</p>
                  ) : (
                    <ol
                      aria-label={`Console of ${node}`}
                      className="rounded bg-surface-muted p-2 font-mono text-xs whitespace-pre-wrap"
                    >
                      {lines.map((line, index) => (
                        // A console line has no id; its position in the capture is its identity.
                        <li key={`${String(index)}:${line}`}>{line}</li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

/**
 * The sandbox test-run panel (C120.7, C126.4, C141.9), under `workflows:trigger` in a sandbox
 * environment only. Its URL is `/workflows/<wfl_id>/test-runs?start-step=<node id>&end-step=<node
 * id>`, with an optional `version-id=<wfv_id>` (the draft when left out), so the editor can link
 * "Test this step"; a range of one Evaluate Code step is that step's test, whose output and
 * console lines the panel shows. A started run is `run=<wfr_id>`, read as the API serves it:
 * values masked fail closed without `pii:view` (C120.6), the console only to its creator.
 */
export default async function TestRunPage({ params, searchParams }: TestRunPageProps) {
  const { id } = await params;
  if (!idSchema('wfl').safeParse(id).success) {
    notFound();
  }
  const query = await searchParams;
  const startStep = stepParam(query['start-step']);
  const endStep = stepParam(query['end-step']);
  const askedVersion = single(query['version-id']);
  const versionId =
    askedVersion !== undefined && idSchema('wfv').safeParse(askedVersion).success
      ? askedVersion
      : '';
  const askedRun = single(query.run);
  const runId =
    askedRun !== undefined && idSchema('wfr').safeParse(askedRun).success ? askedRun : null;
  return renderPage(
    { permissions: ['workflows:read', 'workflows:trigger'] },
    async ({ session, api }) => {
      const can = (permission: Permission) => hasPermission(session, permission);
      const { data: workflow } = await api.workflows.retrieve(id);
      const header = (
        <PageHeader
          breadcrumbs={[
            { label: 'Workflows', href: '/workflows' },
            { label: code(workflow.id), href: `/workflows/${workflow.id}` },
            { label: 'Test run' },
          ]}
          title={`Test ${workflow.attributes.name}`}
          description="A sandbox run that records every message and decides nothing for real unless you acknowledge it."
        />
      );
      if (session.environment.kind !== 'sandbox') {
        return (
          <PageMain className="gap-8">
            {header}
            <Alert tone="info" title="Sandbox only" aria-label="Sandbox only">
              Test runs run only in a sandbox environment: there, every message is recorded and no
              request leaves unless you allow it. Switch to a sandbox environment to test this
              workflow.
            </Alert>
          </PageMain>
        );
      }
      const hasDraft = workflow.relationships['draft-version'].data !== null;
      const [versions, catalogue, chosen, run] = await Promise.all([
        api.workflowVersions.list({ filter: { 'workflow-id': id }, page: { size: 50 } }),
        api.workflows.actions(),
        versionId !== ''
          ? api.workflowVersions.retrieve(versionId)
          : hasDraft
            ? api.workflows.draft(id)
            : Promise.resolve(null),
        runId !== null && can('workflow-runs:read')
          ? Promise.all([api.workflowRuns.retrieve(runId), api.workflowRuns.steps(runId)])
          : Promise.resolve(null),
      ]);
      const definition = chosen?.data.attributes.definition ?? null;
      // C156.6 (V07): the overlay slot gets the version's structure only, never a step's settings.
      const draftDefinition = definition === null ? null : readDraft(definition);
      const overlayDefinition = draftDefinition === null ? null : structureOf(draftDefinition);
      const steps = (definition?.steps ?? []).filter((step) => step.type !== 'output');
      const choices = [
        ...(hasDraft ? [{ id: '', label: 'The draft' }] : []),
        ...versions.data
          .filter((version) => version.attributes.status === 'published')
          .map((version) => ({
            id: version.id,
            label: `Version ${String(version.attributes['version-number'])}`,
          })),
      ];
      const evaluated =
        startStep !== '' && startStep === endStep
          ? (steps.find((step) => step.id === startStep) ?? null)
          : null;
      const codeTest =
        evaluated !== null && actionKeyOf(evaluated) === 'evaluate_code' ? evaluated.id : null;
      return (
        <PageMain className="gap-8">
          {header}
          {codeTest !== null && (
            <h2 className="text-lg font-semibold">{`Evaluate Code test of ${codeTest}`}</h2>
          )}
          {definition === null ? (
            <Alert tone="info" title="Nothing to test yet">
              This workflow has no draft and no published version to test.
            </Alert>
          ) : (
            <TestRunForm
              workflowId={workflow.id}
              versions={choices}
              versionId={versionId}
              steps={steps.map((step) => step.id)}
              startStep={startStep}
              endStep={endStep}
              acknowledgements={acknowledgementsOf(steps, catalogue.data)}
              action={startTestRun}
            />
          )}
          {runId !== null && (
            <PageSection id="test-run-result" title="Test run result">
              {run === null ? (
                <p className="text-sm">
                  Run{' '}
                  <Link href={`/workflows/runs/${runId}`} className={LINK_CLASS}>
                    {code(runId)}
                  </Link>{' '}
                  started. Reading its steps needs workflow-runs:read.
                </p>
              ) : (
                <TestRunResult
                  runId={runId}
                  status={runStatusWords(
                    run[0].data.attributes.status,
                    run[0].data.attributes['step-outcomes'],
                  )}
                  steps={run[1].data}
                  facts={{
                    redactedAt: run[0].data.attributes['redacted-at'],
                    valuesPurgedAt: run[0].data.attributes['values-purged-at'],
                  }}
                  focus={codeTest}
                />
              )}
              {run !== null && overlayDefinition !== null && (
                <RunOverlay
                  definition={overlayDefinition}
                  run={{
                    id: runId,
                    status: run[0].data.attributes.status,
                    steps: run[1].data.map((step) => ({
                      nodeId: step.attributes['node-id'],
                      iterationPath: step.attributes['iteration-path'],
                      status: step.attributes.status,
                      overridden: step.attributes.overridden,
                      simulated: step.attributes.simulated,
                    })),
                  }}
                />
              )}
            </PageSection>
          )}
          {runId !== null && can('sandbox:read') && (
            <PageSection id="test-run-messages" title="Recorded messages">
              <RecordedMessages runId={runId} action={searchRecordedMessages} />
            </PageSection>
          )}
        </PageMain>
      );
    },
  );
}
