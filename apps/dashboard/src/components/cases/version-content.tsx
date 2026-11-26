import type { CaseTemplateVersionResource, FieldSchema } from '@openverify/contracts';
import { DataTable } from '../data-table';
import { Detail } from '../detail';
import { CASES_REPORTS_COPY } from '../../lib/copy/cases-reports';
import { FIELD_TYPE_LABELS } from '../transactions/transaction-words';
import {
  ATTACHMENT_TYPE_WORDS,
  HELD_OBJECT_TYPE_WORDS,
  LAYOUT_MODULE_WORDS,
  SLA_STARTS_ON_WORDS,
  STATUS_CATEGORY_WORDS,
} from './case-words';

type Attributes = CaseTemplateVersionResource['attributes'];

/** The configuration a version names, by id, with each one's name where the reader may read it. */
export interface VersionNames {
  readonly queues: ReadonlyMap<string, string>;
  readonly assignmentPolicies: ReadonlyMap<string, string>;
  readonly slaPolicies: ReadonlyMap<string, string>;
}

/** A named id: its name when known, and the id itself, so it can be found in the API. */
function Named({
  id,
  names,
}: {
  readonly id: string | null;
  readonly names: ReadonlyMap<string, string>;
}) {
  if (id === null) {
    return <span>None</span>;
  }
  const name = names.get(id);
  return (
    <span className="flex flex-col">
      {name !== undefined && <span>{name}</span>}
      <code className="font-mono text-xs">{id}</code>
    </span>
  );
}

/** A field type in words, or the type itself when the console does not know it. */
const typeWords = (type: string): string =>
  (FIELD_TYPE_LABELS as Readonly<Record<string, string | undefined>>)[type] ?? type;

const MEMBERS_COPY = CASES_REPORTS_COPY.versionMembers;

/**
 * A version's layout in words (C172.1): "2 columns: Comments in column 2 (collapsed at first)", or
 * that the default layout applies.
 */
export function layoutWords(layout: Attributes['layout']): string {
  if (layout === null || layout === undefined) {
    return CASES_REPORTS_COPY.layout.defaultLayout;
  }
  const modules = [...layout.modules]
    .sort((a, b) => a.column - b.column || a.order - b.order)
    .map(
      (module) =>
        `${LAYOUT_MODULE_WORDS[module.key]} in column ${String(module.column)}${module.collapsed ? ' (collapsed at first)' : ''}`,
    );
  const columns = `${String(layout.columns)} ${layout.columns === 1 ? 'column' : 'columns'}`;
  return modules.length === 0 ? `${columns}: no module` : `${columns}: ${modules.join('; ')}`;
}

/** "JPEG, PNG, PDF; at most 20 a case", or that none are taken. */
export function attachmentPolicyWords(policy: Attributes['attachment-policy']): string {
  if (policy['max-files'] === 0 || policy.types.length === 0) {
    return 'No attachments';
  }
  return `${policy.types.map((type) => ATTACHMENT_TYPE_WORDS[type]).join(', ')}; at most ${String(policy['max-files'])} a case`;
}

/** The field schemas of a version (or of a template's published version), top level. */
export function FieldsTable({ fieldSchemas }: { readonly fieldSchemas: readonly FieldSchema[] }) {
  return (
    <DataTable
      caption="Fields"
      rows={fieldSchemas}
      getRowKey={(field) => field.key}
      emptyMessage="This version has no fields."
      columns={[
        {
          id: 'key',
          header: 'Key',
          rowHeader: true,
          cell: (field) => <code className="font-mono text-xs">{field.key}</code>,
        },
        { id: 'label', header: 'Label', cell: (field) => field.label },
        { id: 'type', header: 'Type', cell: (field) => typeWords(field.type) },
        {
          id: 'searchable',
          header: 'Searchable',
          cell: (field) =>
            (field as { searchable?: boolean }).searchable === true
              ? 'Searchable'
              : 'Not searchable',
        },
      ]}
    />
  );
}

/**
 * A version's content read-only, every member in words (C130.2): its statuses with their categories,
 * SLA pauses, required comments and tags, and the moves out of each; its resolutions and fields; and
 * the queue, policies, SLA start, held objects, attachments, notices and modules it starts a case with.
 */
export function VersionContent({
  attributes,
  names,
}: {
  readonly attributes: Attributes;
  readonly names: VersionNames;
}) {
  const labels = new Map(attributes.statuses.map((status) => [status.key, status.label]));
  return (
    <div className="flex flex-col gap-6">
      <DataTable
        caption="Statuses"
        rows={attributes.statuses}
        getRowKey={(status) => status.key}
        emptyMessage="This version has no statuses."
        columns={[
          { id: 'label', header: 'Status', rowHeader: true, cell: (status) => status.label },
          {
            id: 'key',
            header: 'Key',
            cell: (status) => <code className="font-mono text-xs">{status.key}</code>,
          },
          {
            id: 'category',
            header: 'Category',
            cell: (status) => STATUS_CATEGORY_WORDS[status.category],
          },
          {
            id: 'sla',
            header: 'SLA',
            cell: (status) => (status['pauses-sla'] ? 'Pauses the SLA' : 'Keeps the SLA running'),
          },
          {
            id: 'comment',
            header: 'Comment',
            cell: (status) => (status['required-comment'] ? 'Needs a comment' : 'Optional'),
          },
          {
            id: 'tags',
            header: 'Status tags',
            cell: (status) =>
              status['status-tags'].length === 0
                ? 'None'
                : `${status['status-tags'].map((tag) => tag.label).join(', ')}${status['status-tag-required'] ? ' (one is needed)' : ''}`,
          },
          {
            id: 'requires',
            header: MEMBERS_COPY.requiresFields,
            cell: (status) =>
              (status['requires-fields'] ?? []).length === 0
                ? 'Nothing'
                : (status['requires-fields'] ?? []).join(', '),
          },
          {
            id: 'moves',
            header: 'Moves to',
            cell: (status) => {
              const to = attributes.transitions[status.key] ?? [];
              return to.length === 0
                ? 'No moves out'
                : to.map((key) => labels.get(key) ?? key).join(', ');
            },
          },
        ]}
      />
      <FieldsTable fieldSchemas={attributes['field-schemas']} />
      <DataTable
        caption={MEMBERS_COPY.checklists}
        rows={(attributes.checklists ?? []).flatMap((checklist) =>
          checklist.items.map((item) => ({ checklist, item })),
        )}
        getRowKey={({ checklist, item }) => `${checklist.key}/${item.key}`}
        emptyMessage={MEMBERS_COPY.noChecklists}
        columns={[
          {
            id: 'checklist',
            header: 'Checklist',
            cell: ({ checklist }) => checklist.label,
          },
          { id: 'item', header: 'Item', rowHeader: true, cell: ({ item }) => item.label },
          {
            id: 'required',
            header: CASES_REPORTS_COPY.checklists.requiredFor,
            cell: ({ item }) =>
              item['required-for-statuses'].length === 0
                ? 'No status'
                : item['required-for-statuses'].map((key) => labels.get(key) ?? key).join(', '),
          },
        ]}
      />
      <DataTable
        caption={MEMBERS_COPY.presetComments}
        rows={attributes['preset-comments'] ?? []}
        getRowKey={(comment) => comment.key}
        emptyMessage={MEMBERS_COPY.noPresetComments}
        columns={[
          { id: 'label', header: 'Preset', rowHeader: true, cell: (comment) => comment.label },
          {
            id: 'text',
            header: 'Text',
            cell: (comment) => <span className="whitespace-pre-wrap">{comment.text}</span>,
          },
        ]}
      />
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail term="Resolutions">
          {attributes.resolutions.length === 0 ? 'None' : attributes.resolutions.join(', ')}
        </Detail>
        <Detail term="Default queue">
          <Named id={attributes['default-queue-id']} names={names.queues} />
        </Detail>
        <Detail term="Assignment policy">
          <Named id={attributes['assignment-policy-id']} names={names.assignmentPolicies} />
        </Detail>
        <Detail term="SLA policy">
          <Named id={attributes['sla-policy-id']} names={names.slaPolicies} />
        </Detail>
        <Detail term="The SLA starts">{SLA_STARTS_ON_WORDS[attributes['sla-starts-on']]}</Detail>
        <Detail term="Objects a case may hold">
          {attributes['held-object-types'].length === 0
            ? 'None'
            : attributes['held-object-types']
                .map((type) => HELD_OBJECT_TYPE_WORDS[type])
                .join(', ')}
        </Detail>
        <Detail term="Attachments">{attachmentPolicyWords(attributes['attachment-policy'])}</Detail>
        <Detail term="Told of a new case">
          {attributes['notify-on-create'].length === 0
            ? 'Nobody'
            : attributes['notify-on-create'].join(', ')}
        </Detail>
        <Detail term={MEMBERS_COPY.layout}>{layoutWords(attributes.layout)}</Detail>
        <Detail term="Default modules">
          {attributes['layout-modules'].length === 0
            ? 'None'
            : attributes['layout-modules']
                .map((module) =>
                  module['required-permissions'].length === 0
                    ? LAYOUT_MODULE_WORDS[module.key]
                    : `${LAYOUT_MODULE_WORDS[module.key]} (needs ${module['required-permissions'].join(', ')})`,
                )
                .join(', ')}
        </Detail>
      </dl>
    </div>
  );
}
