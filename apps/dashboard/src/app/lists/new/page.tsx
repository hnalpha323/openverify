import { listKindSchema } from '@openverify/core';
import type { Metadata } from 'next';
import { BiometricAcknowledgementState } from '../../../components/lists/biometric-acknowledgement';
import { CreateListForm } from '../../../components/lists/create-list-form';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { readBiometricAcknowledgement } from '../../../lib/api/lists';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { createList } from '../actions';

export const metadata: Metadata = { title: 'Create a list' };

export interface NewListPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Creates a list on its kind's route (C97.1, C108), with `lists:write`. The face and background
 * acknowledgement (C97.4) is read from the settings with `settings:read`; without it the page says
 * what the API answers until an administrator records it.
 */
export default async function NewListPage({ searchParams }: NewListPageProps) {
  const kind = listKindSchema.safeParse((await searchParams).kind).data ?? 'email-address';
  return renderPage({ permissions: ['lists:write'] }, async ({ session }) => {
    const acknowledgement = await readBiometricAcknowledgement(
      hasPermission(session, 'settings:read'),
    );
    return (
      <PageMain width="narrow">
        <PageHeader
          breadcrumbs={[{ label: 'Lists', href: '/lists' }, { label: 'Create a list' }]}
          title="Create a list"
          description="A list's kind cannot change later. Values added to it are personal data, shown only to operators with pii:view."
        />
        <BiometricAcknowledgementState acknowledgement={acknowledgement} />
        <CreateListForm
          environmentId={session.environment.id}
          initialKind={kind}
          faceTemplateRetentionDays={
            acknowledgement.kind === 'read' ? acknowledgement.faceTemplateRetentionDays : undefined
          }
          action={createList}
        />
      </PageMain>
    );
  });
}
