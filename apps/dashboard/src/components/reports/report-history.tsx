/**
 * A report's history (C74.2, C86): its runs and actions, newest first, as the API listed them.
 * Each run says its type and status, its times, its match counts, its notes in words
 * (`inquiry_already_decided`, `recurring_limit`, `evidence_changed`, `risk_data_changed`,
 * `match_not_found_in_run` and the rest), its errors in words and its coverage; each action its
 * actor (a user or an API key by its id, or the system; a redaction says who removed the data,
 * owner decision 12), the matches it changed, its review and risk level,
 * and its reason and comment, which are personal data ("Hidden" without `pii:view`).
 */
import type { ReportActionResource, ReportRunResource } from '@openverify/contracts';
import { fromReportResourceType } from '@openverify/core';
import { useId } from 'react';
import type { ReportHistoryEntry } from '../../lib/report-documents';
import {
  REPORT_REVIEW_STATUS_LABELS,
  REPORT_RISK_LEVEL_LABELS,
} from '../../lib/report-match-words';
import {
  REDACTED_BY_SYSTEM,
  REPORT_ACTION_TYPE_LABELS,
  REPORT_RUN_NOTE_WORDS,
  REPORT_RUN_STATUS_LABELS,
  REPORT_RUN_TYPE_LABELS,
  reportErrorText,
} from '../../lib/report-words';
import { Detail } from '../detail';
import { PageSection } from '../lifecycle/page-section';
import { EmptyValue } from '../masked-value';
import { CoverageWords } from './coverage-words';
import { Code, LabelledList, PersonalValue, TimeOrNone, type PiiState } from './report-parts';

const plural = (count: number, word: string) =>
  `${String(count)} ${word}${count === 1 ? '' : 'es'}`;

function RunEntry({ run }: { readonly run: ReportRunResource }) {
  const headingId = useId();
  const { attributes } = run;
  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {REPORT_RUN_TYPE_LABELS[attributes['run-type']]} run:{' '}
        {REPORT_RUN_STATUS_LABELS[attributes.status]}
      </h3>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail term="Scheduled for (UTC)">
          <TimeOrNone value={attributes['scheduled-for']} />
        </Detail>
        <Detail term="Started (UTC)">
          <TimeOrNone value={attributes['started-at']} />
        </Detail>
        <Detail term="Completed (UTC)">
          <TimeOrNone value={attributes['completed-at']} />
        </Detail>
        <Detail term="Matches">
          {plural(attributes['match-count'], 'match')}, {String(attributes['new-match-count'])} new
        </Detail>
        <Detail term="Coverage">
          <CoverageWords
            coverage={attributes.coverage}
            type={fromReportResourceType(run.relationships.report.data.type) ?? 'watchlist'}
          />
        </Detail>
        <Detail term="Run">
          <Code>{run.id}</Code>
        </Detail>
      </dl>
      {attributes.notes.length > 0 && (
        <LabelledList title="Notes">
          {attributes.notes.map((note) => (
            <li key={note}>{REPORT_RUN_NOTE_WORDS[note]}</li>
          ))}
        </LabelledList>
      )}
      {attributes.errors.length > 0 && (
        <LabelledList title="Not screened">
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
    </li>
  );
}

/** A stored actor id in words, by its prefix: `usr_` is the only form left at the end. */
function actorKind(actor: string): string {
  if (actor.startsWith('wfr_')) {
    return 'Workflow run';
  }
  return actor.startsWith('key_') ? 'API key' : 'User';
}

/**
 * Who acted (owner decision 12): a user, an API key or a workflow run by its id, or the system; a
 * redaction by the system is an inquiry's or account's cascade, or the retention setting.
 */
function Actor({
  actor,
  actionType,
}: {
  readonly actor: ReportActionResource['attributes']['actor'];
  readonly actionType: ReportActionResource['attributes']['action-type'];
}) {
  if (actor === 'system') {
    return <>{actionType === 'redact' ? REDACTED_BY_SYSTEM : 'System'}</>;
  }
  return (
    <>
      {actorKind(actor)} <Code>{actor}</Code>
    </>
  );
}

function ActionEntry({
  action,
  state,
}: {
  readonly action: ReportActionResource;
  readonly state: PiiState;
}) {
  const headingId = useId();
  const { attributes } = action;
  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {REPORT_ACTION_TYPE_LABELS[attributes['action-type']]}
      </h3>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail term="When (UTC)">
          <TimeOrNone value={attributes['created-at']} />
        </Detail>
        <Detail term="By">
          <Actor actor={attributes.actor} actionType={attributes['action-type']} />
        </Detail>
        <Detail term="Matches">
          {attributes['match-ids'].length === 0 ? (
            <EmptyValue />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {attributes['match-ids'].map((id) => (
                <li key={id}>
                  <Code>{id}</Code>
                </li>
              ))}
            </ul>
          )}
        </Detail>
        <Detail term="Review status">
          {attributes['review-status'] === null ? (
            <EmptyValue />
          ) : (
            REPORT_REVIEW_STATUS_LABELS[attributes['review-status']]
          )}
        </Detail>
        <Detail term="Risk level">
          {attributes['risk-level'] === null ? (
            <EmptyValue />
          ) : (
            REPORT_RISK_LEVEL_LABELS[attributes['risk-level']]
          )}
        </Detail>
        <Detail term="Reason">
          <PersonalValue value={attributes.reason} state={state} />
        </Detail>
        <Detail term="Comment">
          <PersonalValue value={attributes.comment} state={state} />
        </Detail>
      </dl>
    </li>
  );
}

/** The "History" section of a report. */
export function ReportHistory({
  entries,
  state,
}: {
  readonly entries: readonly ReportHistoryEntry[];
  readonly state: PiiState;
}) {
  return (
    <PageSection id="report-history" title="History">
      {entries.length === 0 ? (
        <p className="text-sm text-ink-muted">No run or action yet.</p>
      ) : (
        <ol aria-label="Runs and actions, newest first" className="flex flex-col gap-3">
          {entries.map((entry) =>
            entry.type === 'report-run' ? (
              <RunEntry key={entry.id} run={entry} />
            ) : (
              <ActionEntry key={entry.id} action={entry} state={state} />
            ),
          )}
        </ol>
      )}
    </PageSection>
  );
}
