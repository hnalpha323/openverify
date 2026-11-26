import type { PeekableAttribute, SourceData } from '@openverify/contracts';
import { DataTable } from '../data-table';
import { SHARE_VERIFICATION_TYPE_WORDS } from './connect-words';

type Verification = Extract<
  SourceData,
  { readonly type: `connect/source-data/verification/${string}` }
>;

const SUBTYPE_WORDS: Readonly<Record<string, string>> = {
  inquiry: 'Inquiry',
  account: 'Account',
  transaction: 'Transaction',
  ...Object.fromEntries(
    Object.entries(SHARE_VERIFICATION_TYPE_WORDS).map(([type, words]) => [
      `verification/${type}`,
      `${words} verification`,
    ]),
  ),
};

const subtypeOf = (type: string) => type.slice('connect/source-data/'.length);

/** A full attribute as its value (structured values as JSON); a presence as present or not. */
function shown(attribute: PeekableAttribute): string {
  if (attribute.visibility === 'presence') {
    return attribute.value ? 'Present' : 'Not present';
  }
  const { value } = attribute;
  if (value === null) {
    return 'Empty at the source';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

interface Row {
  readonly name: string;
  readonly attribute: PeekableAttribute;
}

function AttributeTable({
  caption,
  rows,
  emptyMessage,
}: {
  readonly caption: string;
  readonly rows: readonly Row[];
  readonly emptyMessage: string;
}) {
  return (
    <DataTable
      caption={caption}
      rows={rows}
      getRowKey={(row) => row.name}
      emptyMessage={emptyMessage}
      columns={[
        { id: 'name', header: 'Attribute', rowHeader: true, cell: (row) => row.name },
        {
          id: 'visibility',
          header: 'Shown as',
          cell: (row) => (row.attribute.visibility === 'full' ? 'Value' : 'Presence only'),
        },
        { id: 'value', header: 'At the source', cell: (row) => shown(row.attribute) },
      ]}
    />
  );
}

const rowsOf = (record: Readonly<Record<string, PeekableAttribute>>): Row[] =>
  Object.entries(record).map(([name, attribute]) => ({ name, attribute }));

/** One verification's own filtered snapshot; its files are at most present (C233.3). */
function VerificationTable({ verification }: { readonly verification: Verification }) {
  const rows = rowsOf(verification.attributes);
  return (
    <AttributeTable
      caption={SUBTYPE_WORDS[subtypeOf(verification.type)] ?? subtypeOf(verification.type)}
      rows={
        verification.files === undefined
          ? rows
          : [...rows, { name: 'Files', attribute: verification.files }]
      }
      emptyMessage="The policy shares no attribute here."
    />
  );
}

/**
 * C242.2, C233.2, C233.3: the peek, as the source holds it at this moment. Every exposed attribute
 * is its value or "present" / "not present"; attributes the policy does not share are absent; a
 * file is at most present, and no image or face data is ever in a peek.
 */
export function PeekView({ sourceData }: { readonly sourceData: SourceData }) {
  if (!('fields' in sourceData)) {
    return <VerificationTable verification={sourceData} />;
  }
  const name = SUBTYPE_WORDS[subtypeOf(sourceData.type)] ?? subtypeOf(sourceData.type);
  return (
    <div className="flex flex-col gap-4">
      <AttributeTable
        caption={name}
        rows={rowsOf(sourceData.attributes)}
        emptyMessage="The policy shares no attribute here."
      />
      <AttributeTable
        caption={`${name} fields`}
        rows={rowsOf(sourceData.fields)}
        emptyMessage="The policy shares no field here."
      />
      {'related-objects' in sourceData &&
        sourceData['related-objects'].map((verification, index) => (
          <VerificationTable
            key={`${verification.type}-${String(index)}`}
            verification={verification}
          />
        ))}
    </div>
  );
}
