/**
 * The case page (C142.2, decision 70): a fixed default layout. The header and the status control,
 * assignment, the held objects with their decisions (C142.4), fields, tags, queue and SLA, the
 * modules each visible by its permission, the timeline, comments, attachments and case actions,
 * then print and redaction. Every part renders what the API returned for this reader.
 */
import type { CaseChecklistStateDocument, InquiryFieldValue } from '@openverify/contracts';
import type { CaseHeldObjectType, CaseLayoutModule, Permission } from '@openverify/core';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';
import { CaseChecklists } from '../checklists/case-checklists';
import { checklistViews } from '../checklists/checklist-model';
import { placeActions, type AvailableAction } from '../layout/action-placements';
import { CaseLayoutGrid } from '../layout/case-layout-grid';
import { arrangeModules } from '../layout/layout-model';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import type { DashboardSession } from '../../../lib/api/me';
import { ForbiddenPanel } from '../../forbidden-panel';
import { FieldsEditor } from '../../lifecycle/fields-editor';
import { OptionalSection } from '../../lifecycle/optional-section';
import { PageSection } from '../../lifecycle/page-section';
import { REDACT_PHRASE } from '../../lifecycle/inquiry-action-names';
import { TagEditor } from '../../lifecycle/tag-editor';
import { TypedConfirmButton } from '../../lifecycle/typed-confirm-button';
import { LINK_CLASS } from '../../link-styles';
import { PageHeader } from '../../page-header';
import { PageMain } from '../../page-main';
import { AttachmentUpload } from './attachment-upload';
import { CaseActionForm } from './case-action-form';
import {
  AddObjectsForm,
  AssignmentControl,
  CommentForm,
  QueueForm,
  SlaForm,
  type Person,
} from './case-forms';
import { LIVE_MODULES, caseModuleNodes } from './case-modules';
import { CaseShortcuts } from './case-shortcuts';
import { CompareSection } from './compare-section';
import {
  CaseAttachments,
  CaseComments,
  CaseDetails,
  CaseFields,
  CaseTimeline,
  HeldObjects,
} from './case-sections';
import type { CasePageData } from './load-case';
import { PrintButton, PrintFooter } from './print-button';
import { StatusControl } from './status-control';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface CaseViewActions {
  readonly setStatus: Action;
  readonly assign: Action;
  readonly addComment: Action;
  readonly redactComment: Action;
  readonly addTag: Action;
  readonly removeTag: Action;
  readonly setTags: Action;
  readonly updateFields: Action;
  readonly setQueue: Action;
  readonly setSla: Action;
  readonly addObjects: Action;
  readonly removeObject: Action;
  readonly redact: Action;
  readonly print: Action;
  readonly decide: Action;
  readonly dismissListMatch: Action;
  /** C172.2: one checklist item checked or unchecked. */
  readonly checkItem?: Action;
  readonly runAction: (
    state: ActionState<{ runId: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ runId: string }>>;
}

/** The modules' order on a page whose version has no layout (C142.2), held objects apart. */
const DEFAULT_ORDER: readonly CaseLayoutModule[] = [
  ...LIVE_MODULES,
  'timeline',
  'comments',
  'attachments',
  'case-actions',
];

/** Each held kind's module: inquiries, accounts and the rest show with `held-objects`. */
const KIND_MODULES: Readonly<Record<CaseHeldObjectType, CaseLayoutModule>> = Object.freeze({
  inquiry: 'held-objects',
  account: 'held-objects',
  verification: 'held-objects',
  document: 'held-objects',
  'graph-query': 'held-objects',
  report: 'reports',
  'report-run': 'report-runs',
  transaction: 'transactions',
});

/**
 * The fields the JSON editor offers: the scalar values as the API served them. A list or object
 * value is left out of the document, so it stays as it is (the PATCH merges, C136.4).
 */
function editableFields(
  fields: NonNullable<CasePageData['resource']['attributes']['fields']>,
): Record<string, InquiryFieldValue> {
  const editable: Record<string, InquiryFieldValue> = {};
  for (const [key, { value }] of Object.entries(fields)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      editable[key] = value;
    }
  }
  return editable;
}

export function CaseView({
  data,
  session,
  now,
  actions,
}: {
  readonly data: CasePageData;
  readonly session: DashboardSession;
  readonly now: number;
  readonly actions: CaseViewActions;
}) {
  const can = (permission: Permission) => session.permissions.has(permission);
  const { resource, modules } = data;
  const { attributes } = resource;
  const caseId = resource.id;
  const viewerId = session.user.id;
  const redacted = attributes['redacted-at'] !== null;
  const write = can('cases:write') && !redacted;
  const piiView = can('pii:view');
  const version = data.version.kind === 'ready' ? data.version.data : null;
  const statuses = version?.attributes.statuses ?? null;
  const people: Person[] = [
    ...new Set([
      viewerId,
      ...data.queueMembers,
      ...(attributes['assignee-id'] === null ? [] : [attributes['assignee-id']]),
    ]),
  ].map((id) => ({
    id,
    label: id === viewerId ? `You (${id})` : (data.people.get(id) ?? id),
  }));
  const comments = data.comments.kind === 'ready' ? data.comments.data : [];
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const shownKinds = new Set(
    (Object.keys(KIND_MODULES) as CaseHeldObjectType[]).filter((kind) =>
      modules.has(KIND_MODULES[kind]),
    ),
  );
  const policy = version?.attributes['attachment-policy'];
  const attachments = attributes.attachments;
  const arrangement = arrangeModules(version?.attributes.layout, modules);
  const available = data.actions?.kind === 'ready' ? data.actions.data.data : [];
  const placed = placeActions(available, modules);
  // A status-switcher action shows with the switcher; a reader who sees no switcher finds it with
  // the header's actions instead (C172.5).
  const switcherShown = write && version !== null;
  const headerActions = switcherShown
    ? placed.header
    : [...placed.header, ...placed.statusSwitcher];
  const actionForms = (list: readonly AvailableAction[]) =>
    redacted || list.length === 0 ? null : (
      <div className="flex flex-col gap-3">
        {list.map((each) => (
          <CaseActionForm
            key={each.id}
            caseId={caseId}
            actionId={each.id}
            label={each.attributes.label}
            form={each.attributes.form}
            action={actions.runAction}
          />
        ))}
      </div>
    );
  const actionsFor = (module: CaseLayoutModule) => actionForms(placed.byModule.get(module) ?? []);
  const checklistViewsOf = (state: CaseChecklistStateDocument) =>
    checklistViews(version?.attributes.checklists ?? [], state.data.attributes.items);
  const checklistsNow =
    data.checklist?.kind === 'ready' ? checklistViewsOf(data.checklist.data) : [];
  const nodes: Partial<Record<CaseLayoutModule, ReactNode>> = {
    'held-objects': (
      <OptionalSection
        id="case-held-objects"
        title="Held objects"
        description="Each object as it was attached, beside its state now, read through its own page and permission."
        data={modules.has('held-objects') ? data.held : undefined}
      >
        {(rows) => (
          <div className="flex flex-col gap-4">
            <HeldObjects
              caseId={caseId}
              rows={rows}
              shownKinds={shownKinds}
              canDecide={can('inquiries:write')}
              canEdit={write}
              decide={actions.decide}
              remove={actions.removeObject}
            />
            {write && <AddObjectsForm caseId={caseId} action={actions.addObjects} />}
            {actionsFor('held-objects')}
          </div>
        )}
      </OptionalSection>
    ),
    ...caseModuleNodes({
      caseId,
      data: data.live,
      modules,
      piiView,
      listsRead: can('lists:read'),
      listsWrite: can('lists:write'),
      dismissListMatch: actions.dismissListMatch,
      actionsFor,
    }),
    timeline: (
      <OptionalSection
        id="case-timeline"
        title="Timeline"
        description="What happened to the case, newest first."
        data={modules.has('timeline') ? data.history : undefined}
      >
        {(entries) => (
          <>
            <CaseTimeline
              entries={entries}
              statuses={statuses}
              comments={commentsById}
              viewerId={viewerId}
              people={data.people}
            />
            {actionsFor('timeline')}
          </>
        )}
      </OptionalSection>
    ),
    comments: (
      <OptionalSection
        id="case-comments"
        title="Comments"
        data={modules.has('comments') ? data.comments : undefined}
      >
        {(list) => (
          <div className="flex flex-col gap-4">
            {write && (
              <CommentForm
                caseId={caseId}
                people={people}
                action={actions.addComment}
                presets={version?.attributes['preset-comments'] ?? []}
              />
            )}
            <CaseComments
              caseId={caseId}
              comments={list}
              viewerId={viewerId}
              people={data.people}
              canRedactAny={can('cases:redact')}
              canWrite={can('cases:write')}
              redact={actions.redactComment}
            />
            {actionsFor('comments')}
          </div>
        )}
      </OptionalSection>
    ),
    attachments: modules.has('attachments') && (
      <PageSection id="case-attachments" title="Attachments">
        <CaseAttachments caseId={caseId} attachments={attachments} masked={!piiView} />
        {write && (
          <AttachmentUpload
            caseId={caseId}
            remaining={(policy?.['max-files'] ?? 20) - attachments.length}
          />
        )}
        {actionsFor('attachments')}
      </PageSection>
    ),
    'case-actions': (
      <OptionalSection
        id="case-actions"
        title="Case actions"
        description="Workflows bound to this case's template; each runs with its own grant."
        data={redacted ? undefined : data.actions}
      >
        {() =>
          headerActions.length === 0 ? (
            <p className="text-sm text-ink-muted">No case action is available to you here.</p>
          ) : (
            actionForms(headerActions)
          )
        }
      </OptionalSection>
    ),
  };

  return (
    <PageMain>
      <div data-case-print="" className="flex flex-col gap-8">
        <PageHeader
          title={attributes.name}
          breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: attributes.name }]}
          actions={
            <div className="flex flex-wrap items-start gap-3 print:hidden">
              <CaseShortcuts />
              {can('cases:export') && (
                // C138.1: an export takes a filter or a search, and neither names one case, so
                // the entry point is the exports page, where the reader picks what to export.
                <Link href="/cases/exports" className={`${LINK_CLASS} self-center`}>
                  Exports
                </Link>
              )}
              <PrintButton caseId={caseId} action={actions.print} />
              {can('cases:redact') && !redacted && (
                <TypedConfirmButton
                  label="Redact case"
                  title="Redact this case?"
                  description="Its fields, comment words and attachment files are removed for good. The objects it holds are not redacted with it."
                  phrase={REDACT_PHRASE}
                  confirmLabel="Redact case"
                  pendingLabel="Redacting…"
                  action={actions.redact}
                  fields={{ 'case-id': caseId }}
                  successMessage="The case was redacted."
                />
              )}
            </div>
          }
        />
        {redacted && (
          <p
            role="status"
            aria-label="Redacted"
            className="rounded-lg border border-line bg-canvas p-3 text-sm"
          >
            This case was redacted: its fields, comment words and files are gone; its history stays.
          </p>
        )}
        <CaseDetails
          resource={resource}
          template={data.template}
          statuses={statuses}
          queueName={data.queueName}
          viewerId={viewerId}
          people={data.people}
          now={now}
        />

        {write && (
          <PageSection id="case-status" title="Status">
            {version === null ? (
              <ForbiddenPanel permissions={['case-templates:read']} headingLevel={3} />
            ) : (
              <StatusControl
                caseId={caseId}
                lockVersion={attributes['lock-version']}
                current={attributes.status}
                statuses={version.attributes.statuses}
                transitions={version.attributes.transitions}
                resolutions={version.attributes.resolutions}
                action={actions.setStatus}
                checklists={checklistsNow}
                fieldLabels={
                  new Map(
                    version.attributes['field-schemas'].map((field) => [field.key, field.label]),
                  )
                }
                placedActions={actionForms(placed.statusSwitcher)}
              />
            )}
          </PageSection>
        )}

        {arrangement !== null && !modules.has('case-actions') && nodes['case-actions']}

        <OptionalSection
          id="case-checklists"
          title={CASES_REPORTS_COPY.checklists.title}
          data={data.checklist}
        >
          {(state) => (
            <CaseChecklists
              caseId={caseId}
              lockVersion={state.data.attributes['lock-version']}
              checklists={checklistViewsOf(state)}
              statusLabels={new Map((statuses ?? []).map((each) => [each.key, each.label]))}
              people={data.people}
              canWrite={write && actions.checkItem !== undefined}
              action={actions.checkItem ?? (() => Promise.resolve({ ok: true, data: undefined }))}
            />
          )}
        </OptionalSection>

        {write && (
          <PageSection id="case-assignment" title="Assignment">
            <AssignmentControl
              caseId={caseId}
              lockVersion={attributes['lock-version']}
              viewerId={viewerId}
              assigneeId={attributes['assignee-id']}
              people={people}
              canAssignOthers={can('cases:assign')}
              action={actions.assign}
            />
          </PageSection>
        )}

        {arrangement === null && nodes['held-objects']}

        {data.live.inquiry !== null && (
          <PageSection
            id="case-compare"
            title="Compare"
            description="The held inquiry's document portrait beside its selfie, as renditions. Viewing aids change nothing stored."
          >
            <div
              tabIndex={-1}
              data-shortcut-target="compare"
              className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <CompareSection document={data.live.inquiry} piiView={piiView} />
            </div>
          </PageSection>
        )}

        <PageSection id="case-fields" title="Fields">
          <CaseFields fields={attributes.fields} masked={!piiView} />
          {write && piiView && attributes.fields !== null && (
            <FieldsEditor
              fields={editableFields(attributes.fields)}
              hiddenFields={{ 'case-id': caseId }}
              description="Checked against the template version's field schemas. The keys you send are merged; the others, lists and objects among them, stay."
              action={actions.updateFields}
            />
          )}
        </PageSection>

        <PageSection id="case-tags" title="Tags">
          <TagEditor
            tags={attributes.tags}
            fields={{ 'case-id': caseId }}
            canEdit={write}
            addTag={actions.addTag}
            removeTag={actions.removeTag}
            setTags={actions.setTags}
          />
        </PageSection>

        {write && (
          <PageSection id="case-queue-sla" title="Queue and SLA">
            <QueueForm
              caseId={caseId}
              queueId={resource.relationships['case-queue'].data?.id ?? null}
              queues={data.queues ?? []}
              action={actions.setQueue}
            />
            <SlaForm
              caseId={caseId}
              hasSla={attributes['sla-state'] !== 'none'}
              action={actions.setSla}
            />
          </PageSection>
        )}

        {arrangement === null ? (
          DEFAULT_ORDER.map((key) => <Fragment key={key}>{nodes[key]}</Fragment>)
        ) : (
          <CaseLayoutGrid arrangement={arrangement} nodes={nodes} />
        )}

        <PrintFooter
          environment={session.environment.kind}
          caseId={caseId}
          operatorId={viewerId}
          personalData={piiView}
        />
      </div>
    </PageMain>
  );
}
