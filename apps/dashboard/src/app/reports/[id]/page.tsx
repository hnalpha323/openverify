import { idSchema } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ObjectPrintButton, ObjectPrintFooter } from '../../../components/print/object-print';
import { recordObjectPrint } from '../../../components/print/print-actions';
import { ReportView } from '../../../components/reports/report-view';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { getReport } from '../../../lib/api/reports';
import {
  addReportTag,
  dismissReportMatches,
  pauseReport,
  redactReport,
  removeReportTag,
  resumeReport,
  reviewReportMatches,
  runReport,
  setReportTags,
} from '../actions';
import './print.css';

export const metadata: Metadata = { title: 'Report' };

export interface ReportPageProps {
  readonly params: Promise<{ id: string }>;
}

const ACTIONS = {
  dismiss: dismissReportMatches,
  review: reviewReportMatches,
  pause: pauseReport,
  resume: resumeReport,
  run: runReport,
  redact: redactReport,
  addTag: addReportTag,
  removeTag: removeReportTag,
  setTags: setReportTags,
};

/**
 * One report (C86), read with `GET /dashboard/reports/:id` (masked for an operator without
 * `pii:view`, C70.3): its result beside its coverage, what screened it, its query, sources,
 * matches and review, monitoring, history, tags and redaction, each control with the permission
 * the API needs.
 */
export default async function ReportPage({ params }: ReportPageProps) {
  const { id } = await params;
  if (!idSchema('rep').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['reports:read'] }, async ({ session }) => {
    const can = (permission: Permission) => hasPermission(session, permission);
    const document = await getReport(id);
    return (
      <div data-report-print="">
        <ReportView
          document={document}
          abilities={{
            write: can('reports:write'),
            review: can('reports:review') && can('pii:view'),
            redact: can('reports:redact'),
            piiView: can('pii:view'),
            templatesRead: can('report-templates:read'),
            accountsRead: can('accounts:read'),
            inquiriesRead: can('inquiries:read'),
          }}
          actions={ACTIONS}
          print={{
            button: <ObjectPrintButton objectId={document.data.id} action={recordObjectPrint} />,
            footer: (
              <ObjectPrintFooter
                kind="report"
                environment={session.environment.kind}
                objectId={document.data.id}
                operatorId={session.user.id}
                personalData={can('pii:view')}
              />
            ),
          }}
        />
      </div>
    );
  });
}
