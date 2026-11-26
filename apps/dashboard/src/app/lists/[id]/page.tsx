import { Alert } from '@openverify/ui';
import { idSchema, type ListResource } from '@openverify/contracts';
import { LIST_KIND_REGISTRY, type Permission } from '@openverify/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { Detail } from '../../../components/detail';
import { PageSection } from '../../../components/lifecycle/page-section';
import { AddItemForm } from '../../../components/lists/add-item-form';
import { ImportForm } from '../../../components/lists/import-form';
import { ImportersTable } from '../../../components/lists/importers-table';
import { ListStatusBadge } from '../../../components/lists/list-badges';
import { ListItemsTable } from '../../../components/lists/list-items-table';
import { ListSettingsForm } from '../../../components/lists/list-settings-form';
import { LIST_KIND_LABELS, kindOfListType } from '../../../components/lists/list-words';
import { formatCount } from '../../../components/lists/lists-table';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { Timestamp } from '../../../components/timestamp';
import {
  getList,
  listImporters,
  listListItems,
  readBiometricAcknowledgement,
} from '../../../lib/api/lists';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { addListItem, archiveList, archiveListItem, importListItems, updateList } from '../actions';
import { LIST_PURPOSE_WORDS } from '../../../components/lists/list-words';

export const metadata: Metadata = { title: 'List' };

export interface ListPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** An item id, of any kind's prefix: the cursor of the items. */
const ITEM_ID = /^[a-z]+_[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

const itemCursor = (value: unknown) =>
  typeof value === 'string' && ITEM_ID.test(value) ? value : undefined;

function nextItemCursor(next: string | null): string | null {
  if (next === null) {
    return null;
  }
  return itemCursor(new URL(next, 'http://api.invalid').searchParams.get('page[after]')) ?? null;
}

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/** What only the list's kind has (C97.2), in words. */
function kindDetails(list: ListResource): ReactNode {
  const { attributes } = list;
  if ('field-key' in attributes) {
    return <Detail term="Field key">{attributes['field-key']}</Detail>;
  }
  if ('allow-fuzzy-name-first' in attributes) {
    return (
      <Detail term="Fuzzy first names (beta)">{yesNo(attributes['allow-fuzzy-name-first'])}</Detail>
    );
  }
  if ('default-region' in attributes) {
    return <Detail term="Default region">{attributes['default-region'] ?? 'None'}</Detail>;
  }
  if ('case-sensitive' in attributes) {
    return <Detail term="Case-sensitive">{yesNo(attributes['case-sensitive'])}</Detail>;
  }
  if ('use-for-compromised-ids' in attributes) {
    return (
      <Detail term="Compromised ID check">{yesNo(attributes['use-for-compromised-ids'])}</Detail>
    );
  }
  return null;
}

/**
 * One list (C97, C100, C108): its settings, its items (values masked by the API without
 * `pii:view`, C97.6) with adding and archiving, and its imports with the upload. An import needs
 * `importers:write` and `lists:write`; a face or background list has no importer, and its items
 * come from inquiries. Reads `GET /lists/:id`, `GET /list-items?filter[list-id]=` and, with
 * `importers:read`, `GET /importers?filter[list-id]=`.
 */
export default async function ListPage({ params, searchParams }: ListPageProps) {
  const { id } = await params;
  if (!idSchema('lst').safeParse(id).success) {
    notFound();
  }
  const after = itemCursor((await searchParams).after);
  return renderPage({ permissions: ['lists:read'] }, async ({ session }) => {
    const can = (...permissions: Permission[]) => hasPermission(session, ...permissions);
    const [{ data: list }, items] = await Promise.all([getList(id), listListItems(id, after)]);
    const kind = kindOfListType(list.type);
    const { biometric, importer } = LIST_KIND_REGISTRY[kind];
    const active = list.attributes.status === 'active';
    const canWrite = can('lists:write');
    const [importers, acknowledgement] = await Promise.all([
      importer && can('importers:read') ? listImporters(id) : Promise.resolve(null),
      biometric && canWrite
        ? readBiometricAcknowledgement(can('settings:read'))
        : Promise.resolve(null),
    ]);
    const { attributes } = list;
    const retention = attributes['item-retention-days'];
    const faceDays =
      acknowledgement?.kind === 'read' ? acknowledgement.faceTemplateRetentionDays : undefined;

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Lists', href: '/lists' }, { label: attributes.name }]}
          title={attributes.name}
          description={<ListStatusBadge status={attributes.status} />}
          actions={
            canWrite && active ? (
              <ConfirmActionButton
                label="Archive list"
                title="Archive this list?"
                description="It stops matching inquiries, screenings and reports, and keeps its items readable. Templates that name it report it as not screened."
                confirmLabel="Archive list"
                pendingLabel="Archiving…"
                action={archiveList}
                fields={{ 'list-id': list.id }}
                successMessage="Archived the list."
              />
            ) : undefined
          }
        />
        {!active && (
          <Alert tone="info" title="Archived">
            This list is archived: it stops matching, and keeps its items readable.
          </Alert>
        )}

        <PageSection id="list-details" title="Details">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Type">{LIST_KIND_LABELS[kind]}</Detail>
            <Detail term="Version">{`v${String(attributes.version)}`}</Detail>
            <Detail term="Items">{formatCount(attributes['item-count'])}</Detail>
            <Detail term="Item retention">
              {retention === null ? 'Kept until removed' : `${String(retention)} days`}
            </Detail>
            <Detail term="Purpose">{LIST_PURPOSE_WORDS[attributes.purpose]}</Detail>
            <Detail term="Screened at completion">
              {yesNo(attributes['screen-at-completion'])}
            </Detail>
            {kindDetails(list)}
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
          {biometric && (
            <p className="text-sm text-ink-muted">
              A face or background list is advisory, beta and H-tier: a match carries its score,
              marks an inquiry for review only when its template asks, and never declines anyone.
            </p>
          )}
        </PageSection>

        {canWrite && (
          <PageSection id="list-settings" title="Settings">
            <ListSettingsForm
              list={list}
              faceTemplateRetentionDays={faceDays}
              action={updateList}
            />
          </PageSection>
        )}

        <PageSection
          id="list-items"
          title="Items"
          description="Values are personal data: they show only to operators with pii:view."
        >
          {canWrite && active && (!biometric || can('pii:view')) && (
            <AddItemForm listId={list.id} kind={kind} action={addListItem} />
          )}
          {canWrite && active && biometric && !can('pii:view') && (
            <p className="text-sm text-ink-muted">
              Adding a face or background item needs pii:view as well as lists:write.
            </p>
          )}
          <ListItemsTable
            items={items.data}
            listId={list.id}
            masked={!can('pii:view')}
            archive={canWrite && active ? archiveListItem : undefined}
          />
          <Pagination
            path={`/lists/${list.id}`}
            query={{}}
            after={after}
            nextCursor={nextItemCursor(items.links.next)}
          />
        </PageSection>

        <PageSection id="list-imports" title="Imports">
          {!importer ? (
            <p className="text-sm text-ink-muted">
              Face and background lists have no importer: add each item from an inquiry.
            </p>
          ) : (
            <>
              {active &&
                (can('importers:write', 'lists:write') ? (
                  <ImportForm listId={list.id} kind={kind} action={importListItems} />
                ) : (
                  <p className="text-sm text-ink-muted">
                    Importing a file needs importers:write and lists:write.
                  </p>
                ))}
              {importers === null ? (
                <p className="text-sm text-ink-muted">Reading imports needs importers:read.</p>
              ) : (
                <ImportersTable importers={importers.data} />
              )}
            </>
          )}
        </PageSection>
      </PageMain>
    );
  });
}
