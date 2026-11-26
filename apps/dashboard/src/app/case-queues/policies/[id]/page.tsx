import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  DISTRIBUTION_WORDS,
  SORT_WORDS,
  agentsWords,
  capacityWords,
} from '../../../../components/cases/case-words';
import { AssignmentPolicyForm } from '../../../../components/cases/queue-forms';
import { Detail } from '../../../../components/detail';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { Timestamp } from '../../../../components/timestamp';
import { getAssignmentPolicy } from '../../../../lib/api/case-policies';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { updateAssignmentPolicy } from '../../actions';

export const metadata: Metadata = { title: 'Assignment policy' };

export interface AssignmentPolicyPageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * One assignment policy (C132.2, C142.1), in words, and edited with `case-queues:write`. Its `sort`
 * and `sources` are stored and served; no drain job reads them yet (8B item 105), so the page says
 * that a policy assigns on entry and waiting cases are pulled. Reads
 * `GET /case-assignment-policies/:id` with `case-queues:read`.
 */
export default async function AssignmentPolicyPage({
  params,
}: AssignmentPolicyPageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!idSchema('cap').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['case-queues:read'] }, async ({ session }) => {
    const { data: policy } = await getAssignmentPolicy(id);
    const { attributes } = policy;
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Case queues', href: '/case-queues' },
            { label: 'Assignment policies', href: '/case-queues/policies' },
            { label: attributes.name },
          ]}
          title={attributes.name}
          description="Assigns a case at once when it enters a queue or is created on a template that names this policy. Waiting cases are pulled: the order and sources are kept for a later drain."
        />
        <PageSection id="assignment-policy-details" title="Details">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail term="Distribution">{DISTRIBUTION_WORDS[attributes.distribution]}</Detail>
            <Detail term="Order of waiting cases">{SORT_WORDS[attributes.sort]}</Detail>
            <Detail term="Agents">{agentsWords(attributes.agents)}</Detail>
            <Detail term="Capacity">{capacityWords(attributes['max-capacity'])}</Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
          <p id="assignment-policy-sources" className="text-sm font-medium">
            Sources, in priority order
          </p>
          <ol aria-labelledby="assignment-policy-sources" className="list-decimal ps-6 text-sm">
            {attributes.sources.map((source) => (
              <li key={source.id}>
                {source.type === 'case-template' ? 'Template' : 'Queue'}{' '}
                <code className="font-mono text-xs">{source.id}</code>
              </li>
            ))}
          </ol>
        </PageSection>
        {hasPermission(session, 'case-queues:write') && (
          <PageSection id="assignment-policy-edit" title="Edit">
            <AssignmentPolicyForm
              environmentId={session.environment.id}
              policy={policy}
              action={updateAssignmentPolicy}
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
