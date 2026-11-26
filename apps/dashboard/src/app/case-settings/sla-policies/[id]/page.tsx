import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ON_REOPEN_WORDS, targetWords } from '../../../../components/cases/case-words';
import { SlaPolicyForm } from '../../../../components/cases/sla-forms';
import { Detail } from '../../../../components/detail';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { Timestamp } from '../../../../components/timestamp';
import { CASE_CALENDAR_CHOICES, listCalendars } from '../../../../lib/api/case-calendars';
import { getSlaPolicy } from '../../../../lib/api/case-policies';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { updateSlaPolicy } from '../../actions';

export const metadata: Metadata = { title: 'SLA policy' };

export interface SlaPolicyPageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * One SLA policy (C133.1, C142.1): its target in business time, its calendar, what a reopened case
 * does, and its revision, which a case pins when its SLA starts; edited with `case-queues:write`.
 * Reads `GET /case-sla-policies/:id` and the calendars to name them, with `case-queues:read`.
 */
export default async function SlaPolicyPage({ params }: SlaPolicyPageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!idSchema('cslap').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['case-queues:read'] }, async ({ session }) => {
    const [{ data: policy }, calendars] = await Promise.all([
      getSlaPolicy(id),
      listCalendars({ size: CASE_CALENDAR_CHOICES }),
    ]);
    const { attributes } = policy;
    const choices = calendars.data.map((calendar) => ({
      id: calendar.id,
      name: calendar.attributes.name,
    }));
    const calendarId = attributes['case-calendar-id'];
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'SLA and calendars', href: '/case-settings' },
            { label: attributes.name },
          ]}
          title={attributes.name}
          description={`Revision ${String(attributes.revision)}. A case pins the revision its SLA started under, so an edit moves only the SLAs that start after it.`}
        />
        <PageSection id="sla-policy-details" title="Details">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail term="Target">{targetWords(attributes['target-minutes'])}</Detail>
            <Detail term="Counted on">
              {calendarId === null
                ? 'Around the clock (24x7)'
                : (choices.find((choice) => choice.id === calendarId)?.name ?? calendarId)}
            </Detail>
            <Detail term="When a case reopens">{ON_REOPEN_WORDS[attributes['on-reopen']]}</Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
        </PageSection>
        {hasPermission(session, 'case-queues:write') && (
          <PageSection id="sla-policy-edit" title="Edit">
            <SlaPolicyForm
              environmentId={session.environment.id}
              policy={policy}
              calendars={choices}
              action={updateSlaPolicy}
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
