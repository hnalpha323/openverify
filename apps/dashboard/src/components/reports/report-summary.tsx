/**
 * The "Result" of a report (C69.4, C78.5, C86, ADR 0002, ADR 0005): its status (about
 * processing), its result beside its coverage and each limit in words (and, for a name screening
 * with complete coverage, what that does not promise: owner decision 6), why it was not fully
 * screened (each error, naming its source), what the result means for its state, the notices,
 * the fields nobody could compute, its tiers and stage, and what screened it (the provider,
 * labelled sandbox, the matcher version and the thresholds). "No match" is said only beside
 * `ready`; an errored report reads "Not screened".
 */
import { REPORT_REGISTRY, fromReportResourceType, type ReportType } from '@openverify/core';
import { useId } from 'react';
import { Detail } from '../detail';
import { EmptyValue } from '../masked-value';
import type { Report } from '../../lib/report-documents';
import { reportResultOf } from '../../lib/report-result';
import { REPORT_TIER_WORDS, resultMeansLines } from '../../lib/report-type-words';
import {
  COMPLETE_COVERAGE_WORDS,
  NAME_SCREENING_TYPES,
  REPORT_COVERAGE_LIMIT_WORDS,
  REPORT_NOTICE_WORDS,
  REPORT_UNAVAILABLE_REASON_WORDS,
  reportErrorText,
} from '../../lib/report-words';
import { PageSection } from '../lifecycle/page-section';
import { LabelledList } from './report-parts';
import { LatestRunNotes } from './run-notes';
import { ReportResultBadge, ReportStatusBadge, StageBadge } from './report-badges';

/** The report's type, from its resource type. */
export function typeOf(report: Report): ReportType {
  return fromReportResourceType(report.type) ?? 'watchlist';
}

function Coverage({
  coverage,
  type,
}: {
  readonly coverage: Report['attributes']['coverage'];
  readonly type: ReportType;
}) {
  if (coverage === null) {
    return <span className="text-ink-muted">Not applicable: this type compares no names.</span>;
  }
  if (coverage.complete && coverage.limits.length === 0) {
    // Owner decision 6: complete coverage is not a promise that every spelling is known.
    return NAME_SCREENING_TYPES.has(type) ? (
      <>
        Complete
        <span className="mt-1 block text-xs text-ink-muted">{COMPLETE_COVERAGE_WORDS}</span>
      </>
    ) : (
      <>Complete</>
    );
  }
  return (
    <>
      Limited
      <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
        {coverage.limits.map((limit) => (
          <li key={limit}>{REPORT_COVERAGE_LIMIT_WORDS[limit]}</li>
        ))}
      </ul>
    </>
  );
}

function Thresholds({ thresholds }: { readonly thresholds: Report['attributes']['thresholds'] }) {
  const entries = Object.entries(thresholds ?? {});
  if (entries.length === 0) {
    return <EmptyValue />;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(([name, value]) => (
        <li key={name}>
          <code className="font-mono text-xs">{name}</code>: {String(value)}
        </li>
      ))}
    </ul>
  );
}

function ResultMeans({ report }: { readonly report: Report }) {
  const id = useId();
  const { attributes } = report;
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="text-sm font-semibold text-ink">
        What this result means
      </h3>
      {resultMeansLines(typeOf(report), attributes.status, attributes['has-match']).map((line) => (
        <p key={line} className="text-sm">
          {line}
        </p>
      ))}
    </div>
  );
}

/** The "Result" section of a report. */
export function ReportSummary({ report }: { readonly report: Report }) {
  const { attributes } = report;
  const type = typeOf(report);
  const definition = REPORT_REGISTRY[type];
  const provider = attributes.provider;
  return (
    <PageSection id="report-result" title="Result">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Detail term="Status">
          <ReportStatusBadge status={attributes.status} />
        </Detail>
        <Detail term="Result">
          <ReportResultBadge
            result={reportResultOf(type, attributes.status, attributes['has-match'])}
          />
        </Detail>
        <Detail term="Coverage">
          <Coverage coverage={attributes.coverage} type={type} />
        </Detail>
      </dl>
      <LatestRunNotes notes={attributes['latest-run-notes']} />
      {attributes.errors.length > 0 && (
        <LabelledList title="Why it was not fully screened">
          {attributes.errors.map((error) => {
            const words = reportErrorText(error);
            return (
              <li key={`${error.code}:${error.source ?? ''}`}>
                {words === undefined ? error.code : `${words.title}: ${words.detail}`}
              </li>
            );
          })}
        </LabelledList>
      )}
      <ResultMeans report={report} />
      {attributes.notices.length > 0 && (
        <LabelledList title="Notices">
          {attributes.notices.map((notice) => (
            <li key={notice}>{REPORT_NOTICE_WORDS[notice]}</li>
          ))}
        </LabelledList>
      )}
      {attributes['unavailable-fields'].length > 0 && (
        <LabelledList title="Not available">
          {attributes['unavailable-fields'].map(({ field, reason }) => (
            <li key={field}>
              <code className="font-mono text-xs">{field}</code>:{' '}
              {REPORT_UNAVAILABLE_REASON_WORDS[reason]}
            </li>
          ))}
        </LabelledList>
      )}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Detail term="Tiers">
          {definition.tiers.map((tier) => REPORT_TIER_WORDS[tier]).join('; ')}
          <span className="block text-xs text-ink-muted">{definition.tierNote}</span>
        </Detail>
        <Detail term="Stage">
          <StageBadge stage={definition.stage} />
        </Detail>
        <Detail term="Provider">
          {provider === null ? (
            'None'
          ) : (
            <>
              <code className="font-mono text-xs">{provider.id}</code>
              {provider.sandbox ? ' (sandbox provider)' : ''}
            </>
          )}
        </Detail>
        <Detail term="Matcher version">
          {attributes['matcher-version'] === null ? (
            <EmptyValue />
          ) : (
            <code className="font-mono text-xs break-all">{attributes['matcher-version']}</code>
          )}
        </Detail>
        <Detail term="Thresholds">
          <Thresholds thresholds={attributes.thresholds} />
        </Detail>
      </dl>
    </PageSection>
  );
}
