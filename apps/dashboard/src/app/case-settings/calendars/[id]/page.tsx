import { idSchema } from '@openverify/contracts';
import { CASE_WEEKDAYS } from '@openverify/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { WEEKDAY_WORDS, intervalsText, weekWords } from '../../../../components/cases/case-words';
import { CalendarForm, HolidayImportForm } from '../../../../components/cases/sla-forms';
import { DataTable } from '../../../../components/data-table';
import { Detail } from '../../../../components/detail';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { Timestamp } from '../../../../components/timestamp';
import { getCalendar } from '../../../../lib/api/case-calendars';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { importHolidays, updateCalendar } from '../../actions';

export const metadata: Metadata = { title: 'Business calendar' };

export interface CalendarPageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * One business calendar (C133.2, C142.1): its zone, its week, holidays and closures. With
 * `case-queues:write` its week and holidays are edited (the API checks the zone's daylight-saving
 * changes over the next two years and names the dates it refuses) and holidays are imported from a
 * CSV; an edit or an import recomputes the deadlines of the cases on it. Reads
 * `GET /case-calendars/:id` with `case-queues:read`.
 */
export default async function CalendarPage({ params }: CalendarPageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!idSchema('ccal').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['case-queues:read'] }, async ({ session }) => {
    const { data: calendar } = await getCalendar(id);
    const { attributes } = calendar;
    const canWrite = hasPermission(session, 'case-queues:write');
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'SLA and calendars', href: '/case-settings' },
            { label: attributes.name },
          ]}
          title={attributes.name}
          description={`${attributes['time-zone']}: ${weekWords(attributes.week)}. An edit recomputes the running and paused deadlines of the cases on it.`}
        />
        <PageSection id="calendar-week" title="Business hours">
          <DataTable
            caption="Business hours"
            captionHidden
            rows={CASE_WEEKDAYS}
            getRowKey={(day) => day}
            emptyMessage="No days."
            columns={[
              { id: 'day', header: 'Day', rowHeader: true, cell: (day) => WEEKDAY_WORDS[day] },
              {
                id: 'hours',
                header: 'Open (local time)',
                cell: (day) =>
                  attributes.week[day].length === 0
                    ? 'Closed'
                    : intervalsText(attributes.week[day]),
              },
            ]}
          />
        </PageSection>
        <PageSection id="calendar-holidays" title="Holidays and closures">
          <DataTable
            caption="Holidays"
            rows={attributes.holidays}
            getRowKey={(holiday) => holiday.date}
            emptyMessage="No holidays. None ship with OpenVerify: enter them, or import a CSV."
            columns={[
              { id: 'date', header: 'Date', rowHeader: true, cell: (holiday) => holiday.date },
              { id: 'label', header: 'Label', cell: (holiday) => holiday.label },
            ]}
          />
          <DataTable
            caption="Closures"
            rows={attributes.closures}
            getRowKey={(closure) => `${closure.start}/${closure.end}`}
            emptyMessage="No closures."
            columns={[
              { id: 'start', header: 'From', rowHeader: true, cell: (closure) => closure.start },
              { id: 'end', header: 'Until', cell: (closure) => closure.end },
              { id: 'label', header: 'Label', cell: (closure) => closure.label },
            ]}
          />
          <dl className="grid grid-cols-2 gap-4">
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
        </PageSection>
        {canWrite && (
          <>
            <PageSection id="calendar-edit" title="Edit">
              <CalendarForm
                environmentId={session.environment.id}
                calendar={calendar}
                action={updateCalendar}
              />
            </PageSection>
            <PageSection id="calendar-import" title="Import holidays from a CSV">
              <HolidayImportForm calendarId={calendar.id} action={importHolidays} />
            </PageSection>
          </>
        )}
      </PageMain>
    );
  });
}
