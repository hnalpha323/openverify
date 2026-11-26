import type { FieldSchema, RelationSchema } from '@openverify/contracts';
import { DataTable } from '../data-table';
import { TAG_CLASS } from '../lifecycle/tag-list';
import { FIELD_TYPE_LABELS } from '../transactions/transaction-words';

/** What a field's shared config says, in words (C104.2). */
function fieldFlags(field: FieldSchema): string {
  const config = field.config ?? {};
  const flags = [
    config.required === true ? 'required' : undefined,
    config.searchable === true ? 'searchable' : undefined,
    config['write-policy'] === 'write_once' ? 'write once' : undefined,
    config['redaction-policy'] === 'never' ? 'never redacted' : undefined,
    typeof config['source-key-path'] === 'string'
      ? `alias of ${config['source-key-path']}`
      : undefined,
    config['archived-at'] != null ? 'archived' : undefined,
    config['deactivated-at'] != null ? 'deactivated' : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  return flags.length === 0 ? '—' : flags.join(', ');
}

/**
 * A version's content, read-only (C104.2, C104.5): its fields, statuses and relations. Labels
 * and statuses are not personal data; field schemas hold no value.
 */
export function TypeContent({
  fieldSchemas,
  statuses,
  relationSchemas,
}: {
  readonly fieldSchemas: readonly FieldSchema[];
  readonly statuses: readonly string[];
  readonly relationSchemas: readonly RelationSchema[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <DataTable
        caption="Fields"
        rows={fieldSchemas}
        getRowKey={(field) => field.key}
        emptyMessage="No field."
        columns={[
          { id: 'key', header: 'Key', rowHeader: true, cell: (field) => field.key },
          { id: 'label', header: 'Label', cell: (field) => field.label },
          {
            id: 'type',
            header: 'Type',
            cell: (field) =>
              (FIELD_TYPE_LABELS as Readonly<Record<string, string>>)[field.type] ?? field.type,
          },
          { id: 'flags', header: 'Settings', cell: fieldFlags },
        ]}
      />
      <div className="flex flex-col gap-2">
        <h3 id="type-statuses" className="text-base font-semibold">
          Statuses
        </h3>
        <ul aria-labelledby="type-statuses" className="flex flex-wrap gap-1.5">
          {statuses.map((status) => (
            <li key={status} className={TAG_CLASS}>
              {status}
            </li>
          ))}
        </ul>
      </div>
      <DataTable
        caption="Relations"
        rows={relationSchemas}
        getRowKey={(relation) => relation.key}
        emptyMessage="No relation."
        columns={[
          { id: 'key', header: 'Key', rowHeader: true, cell: (relation) => relation.key },
          {
            id: 'target',
            header: 'Target',
            cell: (relation) => (relation.target === 'account' ? 'Account' : 'Transaction'),
          },
          {
            id: 'cardinality',
            header: 'Targets',
            cell: (relation) => (relation.cardinality === 'one' ? 'One' : 'Many'),
          },
        ]}
      />
    </div>
  );
}
