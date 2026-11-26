import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ON_REOPEN_WORDS, targetWords, weekWords } from '../../components/cases/case-words';
import { CalendarForm, SlaPolicyForm } from '../../components/cases/sla-forms';
import { DataTable } from '../../components/data-table';
import { PageSection } from '../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { CASE_CALENDAR_CHOICES, listCalendars } from '../../lib/api/case-calendars';
import { listSlaPolicies } from '../../lib/api/case-policies';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';
import { createCalendar, createSlaPolicy } from './actions';

export const metadata: Metadata = { title: 'SLA and calendars' };

export interface CaseSettingsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * SLA policies and business calendars (C133, C142.1), each list with its own cursor
 * (`sla-after`, `calendars-after`), and their creation with `case-queues:write`. A policy counts its
 * target in a calendar's business hours, or around the clock; a calendar is checked against its
 * zone's daylight-saving changes when saved. Reads `GET /case-sla-policies` and
 * `GET /case-calendars` with `case-queues:read`.
 */
export default async function CaseSettingsPage({
  searchParams,
}: CaseSettingsPageProps): Promise<ReactNode> {
  const query = await searchParams;
  const slaAfter = parseCursor(query['sla-after'], 'cslap');
  const calendarsAfter = parseCursor(query['calendars-after'], 'ccal');
  return renderPage({ permissions: ['case-queues:read'] }, async ({ session }) => {
    const [policies, calendars] = await Promise.all([
      listSlaPolicies({ after: slaAfter }),
      listCalendars({ after: calendarsAfter }),
    ]);
    // The policies' calendars are named from the page of calendars this page reads.
    const calendarNames = new Map(
      calendars.data.map((calendar) => [calendar.id, calendar.attributes.name]),
    );
    const canWrite = hasPermission(session, 'case-queues:write');
    const choices = canWrite ? (await listCalendars({ size: CASE_CALENDAR_CHOICES })).data : [];
    return (
      <PageMain className="gap-8">
        <PageHeader
          title="SLA and calendars"
          description="An SLA policy sets a case’s deadline in business time; a template version names the policy, when its SLA starts and which statuses pause it. A calendar holds the business hours, holidays and closures that business time counts."
        />
        <PageSection id="sla-policies" title="SLA policies">
          <DataTable
            caption="SLA policies"
            captionHidden
            rows={policies.data}
            getRowKey={(policy) => policy.id}
            emptyMessage="No SLA policies yet."
            columns={[
              {
                id: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (policy) => (
                  <Link href={`/case-settings/sla-policies/${policy.id}`} className={LINK_CLASS}>
                    {policy.attributes.name}
                  </Link>
                ),
              },
              {
                id: 'target',
                header: 'Target',
                cell: (policy) => targetWords(policy.attributes['target-minutes']),
              },
              {
                id: 'calendar',
                header: 'Counted on',
                cell: (policy) => {
                  const id = policy.attributes['case-calendar-id'];
                  return id === null ? 'Around the clock (24x7)' : (calendarNames.get(id) ?? id);
                },
              },
              {
                id: 'reopen',
                header: 'When a case reopens',
                cell: (policy) => ON_REOPEN_WORDS[policy.attributes['on-reopen']],
              },
              {
                id: 'revision',
                header: 'Revision',
                cell: (policy) => `Revision ${String(policy.attributes.revision)}`,
              },
            ]}
          />
          <Pagination
            path="/case-settings"
            query={{ 'calendars-after': calendarsAfter }}
            after={slaAfter}
            nextCursor={cursorFromNextLink(policies.links.next, 'cslap')}
            param="sla-after"
            label="SLA policy pages"
          />
          {canWrite && (
            <SlaPolicyForm
              environmentId={session.environment.id}
              calendars={choices.map((calendar) => ({
                id: calendar.id,
                name: calendar.attributes.name,
              }))}
              action={createSlaPolicy}
            />
          )}
        </PageSection>
        <PageSection id="case-calendars" title="Business calendars">
          <DataTable
            caption="Business calendars"
            captionHidden
            rows={calendars.data}
            getRowKey={(calendar) => calendar.id}
            emptyMessage="No calendars yet: SLA policies count around the clock."
            columns={[
              {
                id: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (calendar) => (
                  <Link href={`/case-settings/calendars/${calendar.id}`} className={LINK_CLASS}>
                    {calendar.attributes.name}
                  </Link>
                ),
              },
              {
                id: 'zone',
                header: 'Time zone',
                cell: (calendar) => calendar.attributes['time-zone'],
              },
              {
                id: 'week',
                header: 'Week',
                cell: (calendar) => weekWords(calendar.attributes.week),
              },
              {
                id: 'holidays',
                header: 'Holidays',
                cell: (calendar) => {
                  const count = calendar.attributes.holidays.length;
                  return `${String(count)} ${count === 1 ? 'holiday' : 'holidays'}`;
                },
              },
            ]}
          />
          <Pagination
            path="/case-settings"
            query={{ 'sla-after': slaAfter }}
            after={calendarsAfter}
            nextCursor={cursorFromNextLink(calendars.links.next, 'ccal')}
            param="calendars-after"
            label="Calendar pages"
          />
          {canWrite && (
            <CalendarForm environmentId={session.environment.id} action={createCalendar} />
          )}
        </PageSection>
      </PageMain>
    );
  });
}
