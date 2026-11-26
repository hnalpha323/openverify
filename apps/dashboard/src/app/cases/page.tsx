import type { CaseResource } from '@openverify/contracts';
import { CASE_SLA_STATES, CASE_STATUS_CATEGORIES } from '@openverify/core';
import { Alert, Button } from '@openverify/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CaseList, NextCaseButton, type CaseRow } from '../../components/cases/case-list';
import {
  caseFilterQuery,
  hasCaseFilters,
  parseCaseQuery,
  type CaseQuery,
} from '../../components/cases/case-query';
import { SLA_STATE_WORDS, STATUS_CATEGORY_WORDS } from '../../components/cases/case-words';
import { EmptyState } from '../../components/empty-state';
import { FormField, controlClassName } from '../../components/form-field';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { CASE_QUEUE_CHOICES, listCaseQueues } from '../../lib/api/case-queues';
import { CASE_TEMPLATE_CHOICES, listCaseTemplates } from '../../lib/api/case-templates';
import { listCases } from '../../lib/api/cases';
import { hasPermission, type DashboardSession } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink } from '../../lib/list-query';
import { createCaseBulkAction, takeNextCase } from './actions';
import { SavedViewsSlot } from '../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'Cases' };

export interface CasesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface Choice {
  readonly id: string;
  readonly name: string;
}

/** A select of choices, keeping a value the list does not name. */
function ChoiceFilter({
  label,
  name,
  value,
  choices,
  every,
  error,
}: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly choices: readonly Choice[];
  readonly every: string;
  readonly error: string | undefined;
}) {
  return (
    <FormField label={label} error={error}>
      {(control) => (
        <select {...control} name={name} defaultValue={value} className={controlClassName(control)}>
          <option value="">{every}</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
          {value !== '' && !choices.some((choice) => choice.id === value) && (
            <option value={value}>{value}</option>
          )}
        </select>
      )}
    </FormField>
  );
}

/** A text filter. */
function TextFilter({
  label,
  name,
  value,
  error,
}: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly error: string | undefined;
}) {
  return (
    <FormField label={label} error={error}>
      {(control) => (
        <input
          {...control}
          name={name}
          defaultValue={value}
          className={controlClassName(control)}
        />
      )}
    </FormField>
  );
}

/** The C129.5 filters as a plain GET form, so they stay in the URL (C23). */
function CaseFilters({
  query,
  templates,
  queues,
}: {
  readonly query: CaseQuery;
  readonly templates: readonly Choice[];
  readonly queues: readonly Choice[];
}) {
  const { values, errors } = query;
  return (
    <form
      role="search"
      aria-label="Filter cases"
      method="get"
      action="/cases"
      className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <ChoiceFilter
        label="Template"
        name="template"
        value={values.template}
        choices={templates}
        every="Every template"
        error={errors.template}
      />
      <ChoiceFilter
        label="Queue"
        name="queue"
        value={values.queue}
        choices={queues}
        every="Every queue"
        error={errors.queue}
      />
      <TextFilter label="Status key" name="status" value={values.status} error={errors.status} />
      <ChoiceFilter
        label="Category"
        name="category"
        value={values.category}
        choices={CASE_STATUS_CATEGORIES.map((id) => ({ id, name: STATUS_CATEGORY_WORDS[id] }))}
        every="Every category"
        error={errors.category}
      />
      <ChoiceFilter
        label="SLA"
        name="sla"
        value={values.sla}
        choices={CASE_SLA_STATES.map((id) => ({ id, name: SLA_STATE_WORDS[id] }))}
        every="Any SLA"
        error={errors.sla}
      />
      <TextFilter
        label="Assignee (usr_…)"
        name="assignee"
        value={values.assignee}
        error={errors.assignee}
      />
      <TextFilter
        label="Account (acc_…)"
        name="account"
        value={values.account}
        error={errors.account}
      />
      <TextFilter
        label="Inquiry (inq_…)"
        name="inquiry"
        value={values.inquiry}
        error={errors.inquiry}
      />
      <TextFilter
        label="Report (rep_…)"
        name="report"
        value={values.report}
        error={errors.report}
      />
      <TextFilter
        label="Reference"
        name="reference"
        value={values.reference}
        error={errors.reference}
      />
      <div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </div>
    </form>
  );
}

/** One case as the list shows it: its ids, keys and words, never its fields or filenames. */
function rowOf(
  resource: CaseResource,
  session: DashboardSession,
  templates: ReadonlyMap<string, string>,
  queues: ReadonlyMap<string, string>,
): CaseRow {
  const { attributes, relationships } = resource;
  const templateId = relationships['case-template'].data.id;
  const queueId = relationships['case-queue'].data?.id ?? null;
  const assignee = attributes['assignee-id'];
  return {
    id: resource.id,
    name: attributes.name,
    status: attributes.status,
    category: attributes['status-category'],
    resolution: attributes.resolution,
    template: templates.get(templateId) ?? templateId,
    queue: queueId === null ? null : (queues.get(queueId) ?? queueId),
    assignee: assignee === null ? null : assignee === session.user.id ? 'You' : assignee,
    slaState: attributes['sla-state'],
    slaExpiresAt: attributes['sla-expires-at'],
    createdAt: attributes['created-at'],
    tags: attributes.tags,
    redacted: attributes['redacted-at'] !== null,
  };
}

const choicesOf = (resources: readonly { id: string; attributes: { name: string } }[]) =>
  resources.map((resource) => ({ id: resource.id, name: resource.attributes.name }));

/**
 * The case list (C129.5, C137, C142.1): the session environment's cases, newest first, filtered in
 * the URL by C129.5's filters, with the columns this browser keeps; "next case" from the operator's
 * queues and bulk actions with `cases:write`; links to the notifications and, with `cases:export`,
 * the exports. A case's fields and attachments are never listed. Reads `GET /cases`, and the
 * templates and queues to name them where the role reads them.
 */
export default async function CasesPage({ searchParams }: CasesPageProps): Promise<ReactNode> {
  const query = parseCaseQuery(await searchParams);
  return renderPage({ permissions: ['cases:read'] }, async ({ session }) => {
    const can = (permission: Parameters<typeof hasPermission>[1]) =>
      hasPermission(session, permission);
    const [templates, queues] = await Promise.all([
      can('case-templates:read')
        ? listCaseTemplates({ size: CASE_TEMPLATE_CHOICES }).then((page) => choicesOf(page.data))
        : Promise.resolve([]),
      can('case-queues:read')
        ? listCaseQueues({}, { size: CASE_QUEUE_CHOICES }).then((page) => choicesOf(page.data))
        : Promise.resolve([]),
    ]);
    const canWrite = can('cases:write');
    const header = (
      <PageHeader
        title="Cases"
        description="Review work on inquiries, accounts, reports and transactions, newest first. A case’s fields, comments and attachments are on its own page, shown with pii:view."
        actions={
          <>
            <Link href={`/cases?assignee=${session.user.id}`} className={LINK_CLASS}>
              Assigned to me
            </Link>
            <Link href="/cases/notifications" className={LINK_CLASS}>
              Notifications
            </Link>
            {can('cases:export') && (
              <Link href="/cases/exports" className={LINK_CLASS}>
                Exports
              </Link>
            )}
            {canWrite && <NextCaseButton action={takeNextCase} queueId={query.filters.queueId} />}
          </>
        }
      />
    );
    const filters = <CaseFilters query={query} templates={templates} queues={queues} />;
    if (Object.keys(query.errors).length > 0) {
      return (
        <PageMain>
          {header}
          {filters}
          <Alert tone="warning" title="Check the filters">
            Some values cannot be used. Correct them to see the cases.
          </Alert>
        </PageMain>
      );
    }
    const page = await listCases(query.filters, query.after);
    const filtered = hasCaseFilters(query.filters);
    const templateNames = new Map(templates.map((choice) => [choice.id, choice.name]));
    const queueNames = new Map(queues.map((choice) => [choice.id, choice.name]));
    return (
      <PageMain>
        {header}
        {filters}
        <SavedViewsSlot list="cases" />
        {page.data.length === 0 && !filtered && query.after === undefined ? (
          <EmptyState title="No cases yet">
            Cases appear here once a person, a workflow or the API opens them.
          </EmptyState>
        ) : (
          <CaseList
            rows={page.data.map((resource) => rowOf(resource, session, templateNames, queueNames))}
            emptyMessage={filtered ? 'No cases match these filters.' : 'No more cases.'}
            bulk={
              canWrite
                ? {
                    canAssign: can('cases:assign'),
                    userId: session.user.id,
                    queues,
                    action: createCaseBulkAction,
                  }
                : null
            }
          />
        )}
        <Pagination
          path="/cases"
          query={caseFilterQuery(query.values)}
          after={query.after}
          nextCursor={cursorFromNextLink(page.links.next, 'case')}
        />
      </PageMain>
    );
  });
}
