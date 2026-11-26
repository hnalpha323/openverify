import type { WorkflowTriggerDeliveryResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';
import { WORKFLOW_DELIVERY_STATUS_WORDS, wordOf } from './workflow-words';

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

/**
 * C118.1 (H18): the events owed a run of this workflow, with what became of each: a run started
 * (linked), or why none did (the reason code as the API gives it).
 */
export function TriggerDeliveriesTable({
  deliveries,
}: {
  readonly deliveries: readonly WorkflowTriggerDeliveryResource[];
}) {
  return (
    <DataTable
      caption="Trigger deliveries"
      captionHidden
      rows={deliveries}
      getRowKey={(delivery) => delivery.id}
      emptyMessage="No event has been delivered to this workflow yet."
      columns={[
        {
          id: 'event',
          header: 'Event',
          rowHeader: true,
          cell: (delivery) => delivery.attributes['event-name'],
        },
        {
          id: 'status',
          header: 'Outcome',
          cell: (delivery) => wordOf(WORKFLOW_DELIVERY_STATUS_WORDS, delivery.attributes.status),
        },
        {
          id: 'reason',
          header: 'Reason',
          cell: (delivery) =>
            delivery.attributes['reason-code'] === null
              ? 'None'
              : code(delivery.attributes['reason-code']),
        },
        {
          id: 'run',
          header: 'Run',
          cell: (delivery) => {
            const run = delivery.relationships['workflow-run'].data;
            return run === null ? (
              'No run'
            ) : (
              <Link href={`/workflows/runs/${run.id}`} className={LINK_CLASS}>
                {code(run.id)}
              </Link>
            );
          },
        },
        {
          id: 'created',
          header: 'Received (UTC)',
          cell: (delivery) => <Timestamp value={delivery.attributes['created-at']} />,
        },
      ]}
    />
  );
}
