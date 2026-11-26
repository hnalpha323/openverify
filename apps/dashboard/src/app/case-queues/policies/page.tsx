import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  DISTRIBUTION_WORDS,
  SORT_WORDS,
  agentsWords,
  capacityWords,
} from '../../../components/cases/case-words';
import { AssignmentPolicyForm } from '../../../components/cases/queue-forms';
import { DataTable } from '../../../components/data-table';
import { EmptyState } from '../../../components/empty-state';
import { PageSection } from '../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../components/link-styles';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { listAssignmentPolicies } from '../../../lib/api/case-policies';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import { createAssignmentPolicy } from '../actions';

export const metadata: Metadata = { title: 'Assignment policies' };

export interface AssignmentPoliciesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The assignment policies (C132.2, C142.1): each with its distribution, the order of waiting cases,
 * its agents and their capacity in words; creation with `case-queues:write`. Reads
 * `GET /case-assignment-policies` with `case-queues:read`.
 */
export default async function AssignmentPoliciesPage({
  searchParams,
}: AssignmentPoliciesPageProps): Promise<ReactNode> {
  const after = parseCursor((await searchParams).after, 'cap');
  return renderPage({ permissions: ['case-queues:read'] }, async ({ session }) => {
    const page = await listAssignmentPolicies({ after });
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Case queues', href: '/case-queues' },
            { label: 'Assignment policies' },
          ]}
          title="Assignment policies"
          description="How a case that enters a queue, or is created on a template, is assigned at once. An agent is eligible when active, holding cases:write, seeing the template, not paused and under capacity; when nobody is, the case waits to be pulled."
        />
        {page.data.length === 0 && after === undefined ? (
          <EmptyState title="No assignment policies yet">
            Without a policy, cases are pulled by queue members or assigned by hand.
          </EmptyState>
        ) : (
          <DataTable
            caption="Assignment policies"
            captionHidden
            rows={page.data}
            getRowKey={(policy) => policy.id}
            emptyMessage="No more policies."
            columns={[
              {
                id: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (policy) => (
                  <Link href={`/case-queues/policies/${policy.id}`} className={LINK_CLASS}>
                    {policy.attributes.name}
                  </Link>
                ),
              },
              {
                id: 'distribution',
                header: 'Distribution',
                cell: (policy) => DISTRIBUTION_WORDS[policy.attributes.distribution],
              },
              {
                id: 'sort',
                header: 'Waiting cases',
                cell: (policy) => SORT_WORDS[policy.attributes.sort],
              },
              {
                id: 'agents',
                header: 'Agents',
                cell: (policy) => agentsWords(policy.attributes.agents),
              },
              {
                id: 'capacity',
                header: 'Capacity',
                cell: (policy) => capacityWords(policy.attributes['max-capacity']),
              },
            ]}
          />
        )}
        <Pagination
          path="/case-queues/policies"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'cap')}
        />
        {hasPermission(session, 'case-queues:write') && (
          <PageSection id="assignment-policy-create" title="New policy">
            <AssignmentPolicyForm
              environmentId={session.environment.id}
              action={createAssignmentPolicy}
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
