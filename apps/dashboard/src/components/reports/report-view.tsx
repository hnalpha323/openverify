/**
 * One report (C86): what it found and how completely, what screened it, its query and sources,
 * its details, tags and redaction; each control only with the permission the API needs. Values
 * the API masked show as "Hidden"; a redacted report shows what was removed as "Redacted". The
 * console never unmasks: everything here is what `GET /dashboard/reports/:id` answered.
 */
import { REPORT_REGISTRY } from '@openverify/core';
import { Alert } from '@openverify/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { REPORT_TYPE_LABELS } from '../../lib/labels';
import type { DashboardReportDocument, Report } from '../../lib/report-documents';
import { reportResultOf } from '../../lib/report-result';
import { REPORT_ORIGIN_LABELS } from '../../lib/report-words';
import { Detail } from '../detail';
import { REDACT_PHRASE } from '../lifecycle/inquiry-action-names';
import { PageSection } from '../lifecycle/page-section';
import { TagEditor } from '../lifecycle/tag-editor';
import { TypedConfirmButton } from '../lifecycle/typed-confirm-button';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { PageHeader } from '../page-header';
import { PageMain } from '../page-main';
import { formatUtc } from '../timestamp';
import { ReportResultBadge, ReportStatusBadge } from './report-badges';
import { Code, TimeOrNone, type PiiState } from './report-parts';
import { ReportHistory } from './report-history';
import { ReportIgnoreList } from './report-ignore-list';
import { ReportMatches } from './report-matches';
import { ReportMonitoring } from './report-monitoring';
import { ReportQuery } from './report-query';
import { ReportTypeResults } from './report-results';
import { ReportSources, hasSources } from './report-sources';
import { ReportSummary, typeOf } from './report-summary';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** What the operator may see and do on the report page, from the session's permissions. */
export interface ReportAbilities {
  /** `reports:write`: tags, pause, resume, run. */
  readonly write: boolean;
  /** `reports:review` with `pii:view`: review and dismiss matches it can see. */
  readonly review: boolean;
  /** `reports:redact`. */
  readonly redact: boolean;
  /** `pii:view`: without it the API masks the query and every match (C70.3). */
  readonly piiView: boolean;
  /** `report-templates:read`, to link the template. */
  readonly templatesRead: boolean;
  /** `accounts:read`, to link the accounts. */
  readonly accountsRead: boolean;
  /** `inquiries:read`, to link the inquiry. */
  readonly inquiriesRead: boolean;
}

/** The server actions the page's controls run. */
export interface ReportPageActions {
  readonly dismiss: Action;
  readonly review: Action;
  readonly pause: Action;
  readonly resume: Action;
  readonly run: Action;
  readonly redact: Action;
  readonly addTag: Action;
  readonly removeTag: Action;
  readonly setTags: Action;
}

export interface ReportViewProps {
  readonly document: DashboardReportDocument;
  readonly abilities: ReportAbilities;
  readonly actions: ReportPageActions;
  /** C173.3: the page's Print button and its printed footer. */
  readonly print?: { readonly button: ReactNode; readonly footer: ReactNode } | undefined;
}

/** An id, linked to its page when the operator may open it. */
function LinkedId({
  id,
  href,
  linked,
}: {
  readonly id: string;
  readonly href: string;
  readonly linked: boolean;
}) {
  return linked ? (
    <Link href={href} className={LINK_CLASS}>
      <Code>{id}</Code>
    </Link>
  ) : (
    <Code>{id}</Code>
  );
}

function ReportDetails({
  report,
  abilities,
}: {
  readonly report: Report;
  readonly abilities: ReportAbilities;
}) {
  const { attributes, relationships } = report;
  const templateId = relationships['report-template'].data.id;
  const inquiryId = relationships.inquiry.data?.id ?? null;
  const accountId = relationships.account.data?.id ?? null;
  const linked = relationships.accounts.data
    .map((account) => account.id)
    .filter((id) => id !== accountId);
  return (
    <PageSection id="report-details" title="Details">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail term="Template">
          <LinkedId
            id={templateId}
            href={`/report-templates/${templateId}`}
            linked={abilities.templatesRead}
          />
        </Detail>
        <Detail term="Template version">{attributes['report-template-version-name']}</Detail>
        <Detail term="Origin">{REPORT_ORIGIN_LABELS[attributes.origin]}</Detail>
        <Detail term="Inquiry">
          {inquiryId === null ? (
            <EmptyValue />
          ) : (
            <LinkedId
              id={inquiryId}
              href={`/inquiries/${inquiryId}`}
              linked={abilities.inquiriesRead}
            />
          )}
        </Detail>
        <Detail term="Account">
          {accountId === null ? (
            <EmptyValue />
          ) : (
            <LinkedId
              id={accountId}
              href={`/accounts/${accountId}`}
              linked={abilities.accountsRead}
            />
          )}
        </Detail>
        <Detail term="Other linked accounts">
          {linked.length === 0 ? (
            <EmptyValue />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {linked.map((id) => (
                <li key={id}>
                  <LinkedId id={id} href={`/accounts/${id}`} linked={abilities.accountsRead} />
                </li>
              ))}
            </ul>
          )}
        </Detail>
        <Detail term="Created (UTC)">
          <TimeOrNone value={attributes['created-at']} />
        </Detail>
        <Detail term="Completed (UTC)">
          <TimeOrNone value={attributes['completed-at']} />
        </Detail>
        <Detail term="Redacted (UTC)">
          <TimeOrNone value={attributes['redacted-at']} />
        </Detail>
      </dl>
    </PageSection>
  );
}

/** One report: its result, query, sources, details, tags and redaction (C86). */
export function ReportView({ document, abilities, actions, print }: ReportViewProps) {
  const report = document.data;
  const { attributes } = report;
  const type = typeOf(report);
  const redactedAt = attributes['redacted-at'];
  const redacted = redactedAt !== null;
  const state: PiiState = redacted ? 'redacted' : abilities.piiView ? 'visible' : 'hidden';
  const fields = { 'report-id': report.id };
  return (
    <PageMain className="gap-8">
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: <Code>{report.id}</Code> }]}
        title={
          <>
            {REPORT_TYPE_LABELS[report.type]} report <Code>{report.id}</Code>
          </>
        }
        description={
          <span className="flex flex-wrap gap-2">
            <ReportStatusBadge status={attributes.status} />
            <ReportResultBadge
              result={reportResultOf(type, attributes.status, attributes['has-match'])}
            />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-start gap-3">
            {print?.button}
            {abilities.redact && !redacted && (
              <TypedConfirmButton
                label="Redact report"
                title="Redact this report?"
                description="Its query, results, match evidence and the reasons and comments of its history are deleted for good, and its monitoring stops. Its statuses, scores and counts stay. This cannot be undone."
                phrase={REDACT_PHRASE}
                confirmLabel="Redact permanently"
                pendingLabel="Redacting…"
                action={actions.redact}
                fields={fields}
                successMessage="The report was redacted."
              />
            )}
          </div>
        }
      />

      {redacted && (
        <Alert tone="info" title="Redacted" aria-label="Redacted">
          This report was redacted on {formatUtc(redactedAt)} UTC. Its query, results, match
          evidence and history notes were deleted for good, and its monitoring stopped.
        </Alert>
      )}

      <ReportSummary report={report} />
      {REPORT_REGISTRY[type].review === 'matches' && (
        <ReportMatches
          report={report}
          state={state}
          canReview={abilities.review && !redacted}
          dismiss={actions.dismiss}
          review={actions.review}
        />
      )}
      <ReportTypeResults report={report} state={state} />
      <ReportQuery report={report} state={state} />
      {hasSources(report, REPORT_REGISTRY[type].sourceKind !== null) && (
        <ReportSources report={report} />
      )}
      {REPORT_REGISTRY[type].review === 'matches' && (
        <ReportIgnoreList report={report} state={state} />
      )}
      <ReportDetails report={report} abilities={abilities} />
      <PageSection id="report-tags" title="Tags">
        <TagEditor
          tags={attributes.tags}
          fields={fields}
          canEdit={abilities.write && !redacted}
          addTag={actions.addTag}
          removeTag={actions.removeTag}
          setTags={actions.setTags}
        />
      </PageSection>
      <ReportMonitoring
        report={report}
        canAct={abilities.write && !redacted}
        pause={actions.pause}
        resume={actions.resume}
        run={actions.run}
      />
      <ReportHistory entries={document.included ?? []} state={state} />
      {print?.footer}
    </PageMain>
  );
}
