import { idSchema, type ImporterError, type ImporterResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DataTable } from '../../../../components/data-table';
import { Detail } from '../../../../components/detail';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../../components/link-styles';
import { importerProgress } from '../../../../components/lists/importer-progress';
import { ImporterStatusBadge } from '../../../../components/lists/list-badges';
import {
  IMPORTER_MODE_LABELS,
  IMPORT_ERROR_WORDS,
  LIST_KIND_LABELS,
  kindOfListType,
} from '../../../../components/lists/list-words';
import { EmptyValue } from '../../../../components/masked-value';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { Pagination } from '../../../../components/pagination';
import { Timestamp } from '../../../../components/timestamp';
import { getImporter, listImporterErrors } from '../../../../lib/api/lists';
import { renderPage } from '../../../../lib/api/page';

export const metadata: Metadata = { title: 'List import' };

export interface ImporterPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** An error row cursor: the last row seen, a whole number. */
const rowCursor = (value: unknown) =>
  typeof value === 'string' && /^(?:0|[1-9][0-9]{0,8})$/u.test(value) ? Number(value) : undefined;

function nextRowCursor(next: string | null): string | null {
  if (next === null) {
    return null;
  }
  const after = rowCursor(new URL(next, 'http://api.invalid').searchParams.get('page[after]'));
  return after === undefined ? null : String(after);
}

/** What the mode did with the rows, in words, once the import ended. */
function modeOutcome(attributes: ImporterResource['attributes']): string {
  if (attributes.status === 'pending') {
    return 'The import has not finished: reload the page to see its progress.';
  }
  if (attributes.mode === 'all-or-nothing') {
    return attributes.status === 'errored'
      ? 'All or nothing: one refused row refuses the whole file, so no row of it was imported.'
      : 'All or nothing: every row was accepted.';
  }
  return 'Skip invalid rows: the valid rows were imported, and each refused row is listed below.';
}

/**
 * One list import (C100, C108): its progress and counts, and its errors as codes, rows and columns
 * in words (C100.4: never a value), with a CSV of them. Reads `GET /importers/:id` and
 * `GET /importers/:id/errors` with `importers:read`.
 */
export default async function ImporterPage({ params, searchParams }: ImporterPageProps) {
  const { id } = await params;
  if (!idSchema('mprt').safeParse(id).success) {
    notFound();
  }
  const after = rowCursor((await searchParams).after);
  return renderPage({ permissions: ['importers:read'] }, async () => {
    const [{ data: importer }, errors] = await Promise.all([
      getImporter(id),
      listImporterErrors(id, after),
    ]);
    const { attributes } = importer;
    const listId = importer.relationships.list.data.id;
    const hasErrors = attributes['error-count'] > 0 || errors.data.length > 0;

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Lists', href: '/lists' },
            { label: 'The list', href: `/lists/${listId}` },
            { label: importer.id },
          ]}
          title={`Import ${importer.id}`}
          description={LIST_KIND_LABELS[kindOfListType(importer.type)]}
        />
        <PageSection id="importer-progress" title="Progress">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <ImporterStatusBadge status={attributes.status} />
            <span>{importerProgress(attributes)}</span>
          </p>
          <p className="text-sm">{modeOutcome(attributes)}</p>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Mode">{IMPORTER_MODE_LABELS[attributes.mode]}</Detail>
            <Detail term="Encoding">{attributes.encoding}</Detail>
            <Detail term="Started (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term="Ended (UTC)">
              {attributes['completed-at'] === null ? (
                <EmptyValue />
              ) : (
                <Timestamp value={attributes['completed-at']} />
              )}
            </Detail>
            <Detail term="File SHA-256">
              <code className="font-mono text-xs break-all">{attributes['file-sha256']}</code>
            </Detail>
          </dl>
        </PageSection>
        <PageSection
          id="importer-errors"
          title="Errors"
          description="Each refused row by its number and column, and why. A value is never shown, here or in the CSV."
        >
          {hasErrors && (
            <p>
              <a
                href={`/lists/importers/${importer.id}/errors.csv`}
                className={LINK_CLASS}
                download
              >
                Download the errors as CSV
              </a>
            </p>
          )}
          <DataTable<ImporterError>
            caption="Errors"
            captionHidden
            rows={errors.data}
            getRowKey={(error) => `${String(error.row)}:${String(error.column)}:${error.code}`}
            emptyMessage={
              attributes.status === 'pending' ? 'No errors recorded so far.' : 'No errors.'
            }
            columns={[
              {
                id: 'row',
                header: 'Row',
                rowHeader: true,
                cell: (error) => (error.row === null ? 'The whole file' : String(error.row)),
              },
              {
                id: 'column',
                header: 'Column',
                cell: (error) => error.column ?? <EmptyValue />,
              },
              {
                id: 'code',
                header: 'Error',
                cell: (error) => (
                  <div className="flex flex-col">
                    <span>{IMPORT_ERROR_WORDS[error.code]}</span>
                    <code className="font-mono text-xs text-ink-muted">{error.code}</code>
                  </div>
                ),
              },
            ]}
          />
          <Pagination
            path={`/lists/importers/${importer.id}`}
            query={{}}
            after={after === undefined ? undefined : String(after)}
            nextCursor={nextRowCursor(errors.links.next)}
          />
        </PageSection>
      </PageMain>
    );
  });
}
