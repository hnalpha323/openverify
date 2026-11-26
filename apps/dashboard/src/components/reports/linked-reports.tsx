/**
 * The reports of an inquiry or an account (C70.5, C84.3, C84.4, C86): a section of its page, as
 * no tab primitive exists. It lists the reports linked to it (an account's as home or linked
 * account), newest first, as the masked dashboard list answers them, each result beside its
 * coverage and an errored one "Not screened"; a completion report whose run found the inquiry
 * already decided says so (C84.3). The full list is one link away.
 */
import Link from 'next/link';
import { CASES_REPORTS_COPY } from '../../lib/copy/cases-reports';
import type { Report } from '../../lib/report-documents';
import { ForbiddenPanel } from '../forbidden-panel';
import { PageSection } from '../lifecycle/page-section';
import type { SectionData } from '../lifecycle/section-data';
import { LINK_CLASS } from '../link-styles';
import { ReportsTable } from './reports-table';

/** The reports linked to an inquiry or an account, newest first. */
export interface LinkedReportList {
  readonly reports: readonly Report[];
  /** The completion reports whose runs found the inquiry already decided (C84.3). */
  readonly decided: readonly string[];
  /** More reports than the section shows: the reports list has them all. */
  readonly more: boolean;
  /** C173.1: more completion reports than were read in full for their runs. */
  readonly detailReadsCapped?: boolean;
}

export interface LinkedReportsProps {
  readonly subject: { readonly kind: 'inquiry' | 'account'; readonly id: string };
  readonly data: SectionData<LinkedReportList> | undefined;
  /** `report-templates:read`, to link each template version. */
  readonly linkTemplates: boolean;
}

const DESCRIPTIONS = {
  inquiry:
    'Reports linked to this inquiry, newest first. Reports made when it completed run within seconds; an operator who decides it before they finish has decided without them.',
  account: 'Reports linked to this account, as its home account or a linked one, newest first.',
} as const;

/** "Decided before this report finished" (C84.3). */
export const DECIDED_NOTE = 'Decided before this report finished';

/** The "Reports" section of an inquiry or account page; nothing without `reports:read`. */
export function LinkedReports({ subject, data, linkTemplates }: LinkedReportsProps) {
  if (data === undefined || data.kind === 'hidden') {
    return null;
  }
  return (
    <PageSection
      id={`${subject.kind}-reports`}
      title="Reports"
      description={DESCRIPTIONS[subject.kind]}
    >
      {data.kind === 'forbidden' ? (
        <ForbiddenPanel headingLevel={3} />
      ) : data.data.reports.length === 0 ? (
        <p className="text-sm text-ink-muted">No report is linked to this {subject.kind}.</p>
      ) : (
        <>
          <ReportsTable
            reports={data.data.reports}
            caption={`Reports of this ${subject.kind}`}
            linkTemplates={linkTemplates}
            notes={Object.fromEntries(data.data.decided.map((id) => [id, DECIDED_NOTE]))}
            emptyMessage={`No report is linked to this ${subject.kind}.`}
          />
          {data.data.detailReadsCapped === true && (
            <p className="text-sm text-ink-muted">{CASES_REPORTS_COPY.reports.detailReadsCapped}</p>
          )}
          {data.data.more && (
            <p>
              <Link href={`/reports?${subject.kind}-id=${subject.id}`} className={LINK_CLASS}>
                All reports of this {subject.kind}
              </Link>
            </p>
          )}
        </>
      )}
    </PageSection>
  );
}
