import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { membersWords } from '../../components/cases/case-words';
import { CreateQueueForm } from '../../components/cases/queue-forms';
import { DataTable } from '../../components/data-table';
import { EmptyState } from '../../components/empty-state';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { CASE_POLICY_CHOICES, listAssignmentPolicies } from '../../lib/api/case-policies';
import { listCaseQueues } from '../../lib/api/case-queues';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';
import { createCaseQueue } from './actions';

export const metadata: Metadata = { title: 'Case queues' };

export interface CaseQueuesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The case queues (C132.1, C142.1): each with its members, how many are paused, and the assignment
 * policy that assigns its cases; creation with `case-queues:write`. Reads `GET /case-queues` and the
 * policies to name them, with `case-queues:read`.
 */
export default async function CaseQueuesPage({
  searchParams,
}: CaseQueuesPageProps): Promise<ReactNode> {
  const after = parseCursor((await searchParams).after, 'cqueue');
  return renderPage({ permissions: ['case-queues:read'] }, async ({ session }) => {
    const [page, policies] = await Promise.all([
      listCaseQueues({}, { after }),
      listAssignmentPolicies({ size: CASE_POLICY_CHOICES }),
    ]);
    const policyNames = new Map(policies.data.map((policy) => [policy.id, policy.attributes.name]));
    return (
      <PageMain>
        <PageHeader
          title="Case queues"
          description="Where cases wait for a reviewer. Members pull the most urgent case, and a queue’s assignment policy assigns new cases at once when an agent has room."
          actions={
            <Link href="/case-queues/policies" className={LINK_CLASS}>
              Assignment policies
            </Link>
          }
        />
        {hasPermission(session, 'case-queues:write') && (
          <CreateQueueForm environmentId={session.environment.id} action={createCaseQueue} />
        )}
        {page.data.length === 0 && after === undefined ? (
          <EmptyState title="No queues yet">
            A queue gathers cases for its members to pull or for a policy to assign.
          </EmptyState>
        ) : (
          <DataTable
            caption="Case queues"
            captionHidden
            rows={page.data}
            getRowKey={(queue) => queue.id}
            emptyMessage="No more queues."
            columns={[
              {
                id: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (queue) => (
                  <Link href={`/case-queues/${queue.id}`} className={LINK_CLASS}>
                    {queue.attributes.name}
                  </Link>
                ),
              },
              {
                id: 'status',
                header: 'Status',
                cell: (queue) => (queue.attributes.status === 'active' ? 'Active' : 'Archived'),
              },
              {
                id: 'members',
                header: 'Members',
                cell: (queue) => membersWords(queue.attributes.members),
              },
              {
                id: 'policy',
                header: 'Assignment policy',
                cell: (queue) => {
                  const id = queue.attributes['case-assignment-policy-id'];
                  return id === null
                    ? 'None: pulled or assigned by hand'
                    : (policyNames.get(id) ?? id);
                },
              },
            ]}
          />
        )}
        <Pagination
          path="/case-queues"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'cqueue')}
        />
      </PageMain>
    );
  });
}
