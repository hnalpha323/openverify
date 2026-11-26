import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { QueueSettingsForm } from '../../../components/cases/queue-forms';
import {
  QueueMembersEditor,
  type DirectoryEntry,
} from '../../../components/cases/queue-members-editor';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { DataTable } from '../../../components/data-table';
import { Detail } from '../../../components/detail';
import { PageSection } from '../../../components/lifecycle/page-section';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Timestamp } from '../../../components/timestamp';
import { CASE_POLICY_CHOICES, listAssignmentPolicies } from '../../../lib/api/case-policies';
import { getCaseQueue } from '../../../lib/api/case-queues';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { userDirectory } from '../../../lib/api/users';
import { archiveCaseQueue, setCaseQueueMembers, updateCaseQueue } from '../actions';

export const metadata: Metadata = { title: 'Case queue' };

export interface CaseQueuePageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * One case queue (C132.1, C142.1): its policy and its members, each with the open cases they take at
 * most and whether they are paused; with `case-queues:write` the members, the name and the policy are
 * edited and the queue archived. Members are named by email with `users:read` (decision 64: emails in
 * the console only). Reads `GET /case-queues/:id` and the policies, with `case-queues:read`.
 */
export default async function CaseQueuePage({ params }: CaseQueuePageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!idSchema('cqueue').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['case-queues:read'] }, async ({ session }) => {
    const [{ data: queue }, policies, users] = await Promise.all([
      getCaseQueue(id),
      listAssignmentPolicies({ size: CASE_POLICY_CHOICES }),
      hasPermission(session, 'users:read') ? userDirectory() : Promise.resolve(null),
    ]);
    const { attributes } = queue;
    const active = attributes.status === 'active';
    const canWrite = active && hasPermission(session, 'case-queues:write');
    const choices = policies.data.map((policy) => ({
      id: policy.id,
      name: policy.attributes.name,
    }));
    const policyId = attributes['case-assignment-policy-id'];
    const policyName =
      policyId === null ? null : (choices.find((each) => each.id === policyId)?.name ?? policyId);
    const directory: DirectoryEntry[] =
      users === null
        ? []
        : [...users].map(([userId, user]) => ({
            id: userId,
            label: user.name === null ? user.email : `${user.email} (${user.name})`,
          }));
    const emailOf = (userId: string) => users?.get(userId)?.email;
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Case queues', href: '/case-queues' }, { label: attributes.name }]}
          title={attributes.name}
          description={
            active ? 'Active' : 'Archived: it takes no case, and nothing more is assigned from it.'
          }
          actions={
            canWrite ? (
              <ConfirmActionButton
                label="Archive queue"
                title="Archive this queue?"
                description="It is permanent: the queue takes no case again, and its unassigned cases go back to no queue. Assigned cases keep their assignee."
                confirmLabel="Archive queue"
                pendingLabel="Archiving…"
                action={archiveCaseQueue}
                fields={{ 'case-queue-id': queue.id }}
                successMessage="Archived the queue."
              />
            ) : undefined
          }
        />
        <PageSection id="case-queue-details" title="Details">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Detail term="Assignment policy">
              {policyName ?? 'None: pulled or assigned by hand'}
            </Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
        </PageSection>
        <PageSection
          id="case-queue-members"
          title="Members"
          description="A member pulls the most urgent case of the queue, and its policy assigns them cases while they have room. A paused member keeps their cases and takes no new one."
        >
          {canWrite ? (
            <QueueMembersEditor
              queueId={queue.id}
              members={attributes.members}
              directory={directory}
              action={setCaseQueueMembers}
            />
          ) : (
            <DataTable
              caption="Members"
              captionHidden
              rows={attributes.members}
              getRowKey={(member) => member['user-id']}
              emptyMessage="No members: nobody pulls this queue’s cases."
              columns={[
                {
                  id: 'user',
                  header: 'Member',
                  rowHeader: true,
                  cell: (member) => emailOf(member['user-id']) ?? member['user-id'],
                },
                {
                  id: 'max-open',
                  header: 'Open cases at most',
                  cell: (member) => String(member['max-open']),
                },
                {
                  id: 'paused',
                  header: 'Taking cases',
                  cell: (member) => (member.paused ? 'Paused: takes no new case' : 'Taking cases'),
                },
              ]}
            />
          )}
        </PageSection>
        {canWrite && (
          <PageSection id="case-queue-settings" title="Settings">
            <QueueSettingsForm
              queueId={queue.id}
              name={attributes.name}
              policyId={policyId}
              policies={choices}
              action={updateCaseQueue}
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
