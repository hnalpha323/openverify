import { DataTable } from '../data-table';
import { Detail } from '../detail';
import type { PolicyChange, PolicyStatement } from './share-policy-words';

/** C242.1: the policy in words, one term per member. Works in server and client components. */
export function SharePolicyView({
  statements,
}: {
  readonly statements: readonly PolicyStatement[];
}) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {statements.map((statement) => (
        <Detail key={statement.id} term={statement.term}>
          {statement.value}
        </Detail>
      ))}
    </dl>
  );
}

/** C242.1: what changed between two versions, member by member. */
export function SharePolicyChanges({
  changes,
  beforeVersion,
  afterVersion,
}: {
  readonly changes: readonly PolicyChange[];
  readonly beforeVersion: number;
  readonly afterVersion: number;
}) {
  return (
    <DataTable
      caption={`Changes from version ${String(beforeVersion)} to version ${String(afterVersion)}`}
      rows={changes}
      getRowKey={(row) => row.id}
      emptyMessage="The two versions say the same."
      columns={[
        { id: 'term', header: 'Member', rowHeader: true, cell: (row) => row.term },
        { id: 'before', header: `Version ${String(beforeVersion)}`, cell: (row) => row.before },
        { id: 'after', header: `Version ${String(afterVersion)}`, cell: (row) => row.after },
      ]}
    />
  );
}
