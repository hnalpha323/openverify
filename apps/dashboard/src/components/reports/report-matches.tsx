/**
 * A report's matches (C75, C78.5, C86): each one with its evidence (the subject's name and the
 * list's name side by side, the name level, methods, match types, qualifiers with their score
 * change, the score with its preset and minimum), where it stands (open, dismissed or delisted;
 * its review), an open match the last run did not find marked so (C75.8), and its review and
 * dismissal, only for an operator who may review and can see the evidence. The matches are
 * personal data as a whole: masked without `pii:view` (C70.3), so nothing is offered then.
 */
import type { ReportMatch } from '@openverify/contracts';
import { REPORT_REGISTRY } from '@openverify/core';
import { useId } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import type { Report } from '../../lib/report-documents';
import {
  MATCH_LEVEL_LABELS,
  REPORT_MATCH_STATUS_LABELS,
  REPORT_MATCH_TYPE_WORDS,
  REPORT_REVIEW_STATUS_LABELS,
  REPORT_RISK_LEVEL_LABELS,
  matchMethodWords,
  qualifierText,
} from '../../lib/report-match-words';
import { Detail } from '../detail';
import { HiddenValue } from '../hidden-value';
import { PageSection } from '../lifecycle/page-section';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue } from '../masked-value';
import { DismissMatchesButton, ReviewMatchesButton } from './match-dialogs';
import { Code, TimeOrNone, type PiiState } from './report-parts';
import { typeOf } from './report-summary';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface ReportMatchesProps {
  readonly report: Report;
  /** How personal values show: the matches are PII as a whole (C70.3). */
  readonly state: PiiState;
  /** `reports:review` with `pii:view`. */
  readonly canReview: boolean;
  readonly dismiss: Action;
  readonly review: Action;
}

/** The report's matches as served: `null` when masked or redacted. */
export function matchesOf(report: Report): readonly ReportMatch[] | null {
  return (
    (report.attributes as { readonly matches?: readonly ReportMatch[] | null }).matches ?? null
  );
}

const MEDIA_TYPES: ReadonlySet<string> = new Set([
  'report/adverse-media',
  'report/business-adverse-media',
]);

function scoreText(match: ReportMatch): string {
  const { preset, 'min-score': minimum } = match.components;
  const how = [
    preset === null ? null : `${preset} preset`,
    minimum === null ? null : `minimum ${minimum.toFixed(2)}`,
  ].filter((part) => part !== null);
  return how.length === 0
    ? match.score.toFixed(2)
    : `${match.score.toFixed(2)} (${how.join(', ')})`;
}

function Listed({ items }: { readonly items: readonly string[] }) {
  return items.length === 0 ? <EmptyValue /> : <>{items.join(', ')}</>;
}

function MatchCard({
  match,
  reportId,
  media,
  actions,
  dismiss,
  review,
}: {
  readonly match: ReportMatch;
  readonly reportId: string;
  readonly media: boolean;
  readonly actions: boolean;
  readonly dismiss: Action;
  readonly review: Action;
}) {
  const headingId = useId();
  const { components } = match;
  const unseen = match.status === 'open' && !match['present-in-last-run'];
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <h3 id={headingId} className="text-base font-semibold break-words">
        {match.name}
      </h3>
      {unseen && (
        <p className="text-sm font-medium text-ink">
          Not found by the last run: it stays open until a person dismisses it.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail term="Status">{REPORT_MATCH_STATUS_LABELS[match.status]}</Detail>
        <Detail term="Review">{REPORT_REVIEW_STATUS_LABELS[match['review-status']]}</Detail>
        <Detail term="Risk level">
          {match['risk-level'] === null ? (
            <EmptyValue />
          ) : (
            REPORT_RISK_LEVEL_LABELS[match['risk-level']]
          )}
        </Detail>
        <Detail term="Alert again on change">{match['notify-on-change'] ? 'Yes' : 'No'}</Detail>
        <Detail term="Subject name">{components['subject-name'] ?? <EmptyValue />}</Detail>
        <Detail term="List name">{components['list-name'] ?? <EmptyValue />}</Detail>
        <Detail term="Name level">
          {components['name-level'] === null ? (
            <EmptyValue />
          ) : (
            MATCH_LEVEL_LABELS[components['name-level']]
          )}
        </Detail>
        <Detail term="Methods">
          {components.methods.length === 0 ? (
            <EmptyValue />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {components.methods.map((method) => (
                <li key={method}>{matchMethodWords(method) ?? <Code>{method}</Code>}</li>
              ))}
            </ul>
          )}
        </Detail>
        <Detail term="Match types">
          <Listed items={match['match-types'].map((type) => REPORT_MATCH_TYPE_WORDS[type])} />
        </Detail>
        <Detail term="Qualifiers">
          <Listed items={match.qualifiers.map(qualifierText)} />
        </Detail>
        <Detail term="Score">{scoreText(match)}</Detail>
        <Detail term="Source">
          {match['source-id'] === null ? 'An article' : <Code>{match['source-id']}</Code>}
        </Detail>
        <Detail term="Entity">
          <Code>{match['entity-id']}</Code>
        </Detail>
        <Detail term="Match">
          <Code>{match.id}</Code>
        </Detail>
        <Detail term="First found (UTC)">
          <TimeOrNone value={match['created-at']} />
        </Detail>
        <Detail term="Reviewed (UTC)">
          <TimeOrNone value={match['reviewed-at']} />
        </Detail>
        <Detail term="Delisted (UTC)">
          <TimeOrNone value={match['delisted-at']} />
        </Detail>
        <Detail term="Lapsed from">
          {match['lapsed-from'] === null ? <EmptyValue /> : <Code>{match['lapsed-from']}</Code>}
        </Detail>
      </dl>
      {actions && (
        <div className="flex flex-wrap gap-3">
          <ReviewMatchesButton
            reportId={reportId}
            label="Review"
            accessibleLabel={`Review match ${match.id}`}
            title="Review this match"
            recordToken={match.id}
            action={review}
          />
          {match.status === 'open' && (
            <DismissMatchesButton
              reportId={reportId}
              label="Dismiss"
              accessibleLabel={`Dismiss match ${match.id}`}
              title={media ? 'Dismiss this article?' : 'Dismiss this match?'}
              entityId={match['entity-id']}
              {...(media ? { dismissType: 'media' as const } : {})}
              action={dismiss}
            />
          )}
        </div>
      )}
    </article>
  );
}

/** The "Matches" section of a report with review. */
export function ReportMatches({ report, state, canReview, dismiss, review }: ReportMatchesProps) {
  const matches = matchesOf(report);
  const { status } = report.attributes;
  const reviewable =
    canReview && state === 'visible' && status !== 'pending' && status !== 'submitted';
  const open = matches?.filter((match) => match.status === 'open').length ?? 0;
  const media = MEDIA_TYPES.has(report.type);
  return (
    <PageSection
      id="report-matches"
      title="Matches"
      description="Each match is a lead for a reviewer, never a decision. Only a person, or the entry leaving its list, closes one."
    >
      {matches === null ? (
        state === 'redacted' ? (
          <p>
            <RedactedValue />
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <HiddenValue /> Matches are personal data: your role cannot see them, or review them.
          </p>
        )
      ) : matches.length === 0 ? (
        <p className="text-sm text-ink-muted">None recorded.</p>
      ) : (
        <>
          {reviewable && open > 0 && REPORT_REGISTRY[typeOf(report)].review === 'matches' && (
            <div className="flex flex-wrap gap-3">
              <ReviewMatchesButton
                reportId={report.id}
                label="Review all open matches"
                title="Review every open match"
                action={review}
              />
              <DismissMatchesButton
                reportId={report.id}
                label="Dismiss all open matches"
                title="Dismiss every open match?"
                {...(media ? { dismissType: 'entity' as const } : {})}
                action={dismiss}
              />
            </div>
          )}
          {matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              reportId={report.id}
              media={media}
              actions={reviewable}
              dismiss={dismiss}
              review={review}
            />
          ))}
        </>
      )}
    </PageSection>
  );
}
