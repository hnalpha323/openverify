import {
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
  type VerificationResource,
} from '@openverify/contracts';
import type { ExtractionField } from '@openverify/core';
import { EXTRACTION_FIELD_LABELS, EXTRACTION_SOURCE_LABELS } from '../lib/labels';
import { DataTable, type Column } from './data-table';
import { RedactedValue } from './lifecycle/redacted-value';
import { EmptyValue, MaskedValue } from './masked-value';

type GovernmentIdVerification = Extract<
  VerificationResource,
  { type: 'verification/government-id' }
>;

/**
 * How the extraction may be shown: `visible` with `pii:view`; `hidden` without it, the API
 * having masked every value (C31.6); `redacted` once the inquiry was redacted.
 */
export type ExtractionState = 'visible' | 'hidden' | 'redacted';

export interface ExtractionTableProps {
  readonly verification: GovernmentIdVerification;
  readonly state: ExtractionState;
}

/**
 * A government ID's extraction (C31.5): every attribute the contract lists, in its order, with
 * the value exactly as the API sent it (dates are `YYYY-MM-DD` strings, never parsed, so no time
 * zone can shift them) and the sources that agreed on it. Values come from this verification
 * answer only, which the API masks per operator: "Hidden" without `pii:view` (C31.6), "Redacted"
 * after a redaction. The sources name fields only, so the API leaves them unmasked.
 */
export function ExtractionTable({ verification, state }: ExtractionTableProps) {
  const { attributes } = verification;
  const sources = attributes['extraction-sources'] ?? null;
  if (
    sources === null &&
    GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.every((field) => (attributes[field] ?? null) === null)
  ) {
    return <p className="text-sm text-ink-muted">Nothing was read from this document.</p>;
  }
  const columns: readonly Column<ExtractionField>[] = [
    {
      id: 'field',
      header: 'Field',
      rowHeader: true,
      cell: (field) => EXTRACTION_FIELD_LABELS[field],
    },
    {
      id: 'value',
      header: 'Value',
      cell: (field) =>
        state === 'redacted' ? (
          <RedactedValue />
        ) : (
          <MaskedValue value={attributes[field] ?? null} masked={state === 'hidden'} />
        ),
    },
    {
      id: 'sources',
      header: 'Read from',
      cell: (field) => {
        const read = sources?.[field] ?? [];
        return read.length === 0 ? (
          <EmptyValue />
        ) : (
          read.map((source) => EXTRACTION_SOURCE_LABELS[source]).join(', ')
        );
      },
    },
  ];
  return (
    <DataTable
      caption="Extracted fields"
      captionHidden
      columns={columns}
      rows={GOVERNMENT_ID_EXTRACTION_ATTRIBUTES}
      getRowKey={(field) => field}
      emptyMessage="No fields."
    />
  );
}
