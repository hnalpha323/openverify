import type { TransactionFieldValue, TransactionResource } from '@openverify/contracts';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue, HiddenValue } from '../masked-value';
import { FIELD_TYPE_LABELS } from './transaction-words';

interface FileValue {
  readonly 'file-id': string;
  readonly filename: string;
  readonly 'byte-size': number;
  readonly 'mime-type': string;
}

const isFile = (value: unknown): value is FileValue =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<FileValue>)['file-id'] === 'string' &&
  typeof (value as Partial<FileValue>).filename === 'string';

/**
 * One field's value as the API served it (C105.8): `null` is hidden without `pii:view`. A file
 * shows its name, type and size, and its content is a link to the console's own route, which reads
 * it with the operator's session and `pii:view` (P12).
 */
function FieldValue({
  transactionId,
  field,
  masked,
}: {
  readonly transactionId: string;
  readonly field: TransactionFieldValue;
  readonly masked: boolean;
}) {
  const { value } = field;
  if (value === null || value === undefined) {
    return masked ? <HiddenValue /> : <EmptyValue />;
  }
  if (field.type === 'file' && isFile(value)) {
    return (
      <div className="flex flex-col gap-0.5">
        {masked ? (
          <span>{value.filename}</span>
        ) : (
          <a
            href={`/transactions/${transactionId}/files/${value['file-id']}/content`}
            className={LINK_CLASS}
            download
          >
            Download {value.filename}
          </a>
        )}
        <span className="text-xs text-ink-muted">
          {`${value['mime-type']}, ${value['byte-size'].toLocaleString('en-US')} bytes`}
        </span>
      </div>
    );
  }
  if (typeof value === 'object') {
    return (
      <pre className="max-w-xl overflow-x-auto font-mono text-xs whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  if (typeof value === 'boolean') {
    return <>{value ? 'Yes' : 'No'}</>;
  }
  return (
    <>
      {typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : JSON.stringify(value)}
    </>
  );
}

/** A transaction's fields (C105.1): each key, its type and its value, masked member-wise. */
export function TransactionFields({
  transaction,
  masked,
}: {
  readonly transaction: TransactionResource;
  /** The API masks values for this operator (no `pii:view`). */
  readonly masked: boolean;
}) {
  const { fields } = transaction.attributes;
  if (fields === null) {
    return (
      <p className="text-sm text-ink-muted">
        {transaction.attributes['redacted-at'] === null ? (
          <HiddenValue />
        ) : (
          'The fields were redacted.'
        )}
      </p>
    );
  }
  const rows = Object.entries(fields).map(([key, field]) => ({ key, field }));
  return (
    <DataTable
      caption="Fields"
      captionHidden
      rows={rows}
      getRowKey={(row) => row.key}
      emptyMessage="No field is set."
      columns={[
        { id: 'key', header: 'Field', rowHeader: true, cell: (row) => row.key },
        { id: 'type', header: 'Type', cell: (row) => FIELD_TYPE_LABELS[row.field.type] },
        {
          id: 'value',
          header: 'Value',
          cell: (row) => (
            <FieldValue transactionId={transaction.id} field={row.field} masked={masked} />
          ),
        },
      ]}
    />
  );
}
