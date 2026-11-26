import { idSchema } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { DraftEditor } from '../../../../components/workflows/draft-editor';
import { diffMarksOf } from '../../../../components/workflows/editor/canvas-model';
import { emptyDefinition } from '../../../../components/workflows/editor/document-model';
import type { CatalogueAction } from '../../../../components/workflows/editor/palette-model';
import { VersionDiff } from '../../../../components/workflows/version-diff';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { saveWorkflowDraft } from '../../actions';

export const metadata: Metadata = { title: 'Workflow draft' };

export interface WorkflowDraftPageProps {
  readonly params: Promise<{ id: string }>;
}

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

/** The most modules the palette lists; provisional, ours (a module's id can still be written). */
const MAX_MODULE_CHOICES = 200;

/**
 * K9-7 (R005, C119.8): the workflows the palette offers as modules: this environment's module
 * workflows with a published version, unarchived, which a step runs at `latest-published`. The
 * check accepts exactly a module workflow with a published version (`module_unknown` otherwise).
 */
async function moduleChoices(
  api: OpenVerifyClient,
): Promise<{ readonly id: string; readonly name: string }[]> {
  const modules: { readonly id: string; readonly name: string }[] = [];
  for await (const candidate of api.workflows.listAll({
    filter: { kind: 'module' },
    page: { size: 100 },
  })) {
    if (modules.length === MAX_MODULE_CHOICES) {
      break;
    }
    if (
      candidate.attributes.kind === 'module' &&
      candidate.attributes.status !== 'archived' &&
      candidate.relationships['latest-published-version'].data !== null
    ) {
      modules.push({ id: candidate.id, name: candidate.attributes.name });
    }
  }
  return modules;
}

/**
 * The draft editor (C141.2, C141.4), read with `workflows:read`: the draft's outline and its
 * definition, edited through the outline's menus or as JSON, checked and saved with
 * `workflows:write`, which also reads the action catalogue and the module workflows for the palette. Without a draft, the editor starts
 * from the live version (or an empty definition) at lock version 0, and the first save makes the
 * draft (C116.1).
 */
export default async function WorkflowDraftPage({ params }: WorkflowDraftPageProps) {
  const { id } = await params;
  if (!idSchema('wfl').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['workflows:read'] }, async ({ session, api }) => {
    const { data: workflow } = await api.workflows.retrieve(id);
    const draftId = workflow.relationships['draft-version'].data?.id ?? null;
    const liveId = workflow.relationships['latest-published-version'].data?.id ?? null;
    const source =
      draftId !== null
        ? (await api.workflows.draft(id)).data
        : liveId !== null
          ? (await api.workflowVersions.retrieve(liveId)).data
          : null;
    const diff =
      draftId !== null && liveId !== null
        ? (await api.workflowVersions.diff(draftId, liveId)).data
        : null;
    // C113.1: a workflow without a draft or a published version starts with the output node.
    const definition = source?.attributes.definition ?? emptyDefinition();
    const writable = hasPermission(session, 'workflows:write');
    // C141.4: the palette is the catalogue the API serves, read only for an editor that edits.
    const actions: CatalogueAction[] = writable
      ? (await api.workflows.actions()).data.map(({ attributes }) => ({
          key: attributes.key,
          version: attributes.version,
          kind: attributes.kind,
          stage: attributes.stage,
          delivery: attributes.delivery,
          adverse: attributes.adverse,
          triggers: attributes.triggers,
          available: attributes.available,
          reason: attributes.reason,
          // C141.4, C115.3: the step forms and the variable picker read the schemas.
          configSchema: attributes['config-schema'],
          outputSchema: attributes['output-schema'],
        }))
      : [];
    // K9-7: a module's own draft runs no module (`module_nested`). KP10-15: an account or case
    // action runs none either, but the trigger can change after the page loaded, so the modules are
    // read whatever it is now and the palette refuses them while it is one (`MODULELESS_TRIGGERS`).
    const runsModules = writable && workflow.attributes.kind === 'workflow';
    const modules = runsModules ? await moduleChoices(api) : [];
    const lockVersion = draftId !== null && source !== null ? source.attributes['lock-version'] : 0;
    const warnings =
      draftId !== null && source !== null
        ? source.attributes.warnings.map((issue) => ({
            pointer: issue.pointer,
            code: issue.code,
            detail: issue.detail ?? issue.code,
          }))
        : [];
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Workflows', href: '/workflows' },
            { label: code(workflow.id), href: `/workflows/${workflow.id}` },
            { label: 'Draft' },
          ]}
          title={`Draft of ${workflow.attributes.name}`}
          description={
            draftId !== null
              ? `Version ${String(source?.attributes['version-number'] ?? '')}, not published.`
              : liveId !== null
                ? 'No draft yet: this starts from the live version, and saving makes the draft.'
                : 'No draft yet: this starts from an empty definition, and saving makes the draft.'
          }
        />
        {diff !== null && <VersionDiff diff={diff} />}
        <DraftEditor
          workflowId={workflow.id}
          lockVersion={lockVersion}
          definition={JSON.stringify(definition, null, 2)}
          warnings={warnings}
          actions={actions}
          modules={modules}
          marks={diff === null ? {} : diffMarksOf(diff.attributes)}
          action={writable ? saveWorkflowDraft : undefined}
        />
      </PageMain>
    );
  });
}
