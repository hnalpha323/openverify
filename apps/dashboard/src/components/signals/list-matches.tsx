/**
 * An inquiry's list screening and list matches (C99, C108; H02, H15, H31). The screening says its
 * state, every selected list it could not read with its reason ("not screened", never "no match"),
 * every list the subject had no value for ("no value to compare"), and what it did to the inquiry
 * ("decided before the list screening finished"). Each match says its list, where the value came
 * from, the method, the tier of the evidence and, for IP-derived probes, "approximate". The
 * matched value and a dismissal's reason are PII, shown only as the API answered them.
 */
import type {
  InquiryResource,
  ListMatchResource,
  SignalDetail,
  SignalListScreening,
  SignalValue,
} from '@openverify/contracts';
import Link from 'next/link';
import type { ActionResult, ActionState } from '../../lib/action-state';
import {
  LIST_MATCH_METHOD_WORDS,
  LIST_MATCH_STATUS_WORDS,
  LIST_MATCH_TIER_WORDS,
  LIST_NOT_APPLICABLE_REASON_WORDS,
  LIST_PROBE_SOURCE_WORDS,
  LIST_REVIEW_CAUSE_WORDS,
  LIST_SCREENING_STATUS_WORDS,
  LIST_UNSCREENED_REASON_WORDS,
} from '../../lib/list-match-words';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue, MaskedValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { DbIpAttribution } from './db-ip-attribution';
import { DismissListMatchButton } from './dismiss-list-match';
import { EvidenceMeta } from './evidence';
import { CardPart } from './session-parts';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type Details = InquiryResource['attributes']['signal-details'];

const COUNT = 'inquiry/list_match_count';

/** What the console knows of an inquiry's list screening (C99.4). */
export type ScreeningView =
  | { readonly kind: 'not-served' }
  | { readonly kind: 'not-computed' }
  | { readonly kind: 'no-lists' }
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'screening';
      readonly screening: SignalListScreening;
      readonly count: number | null;
    };

/**
 * C99.4: the screening as `signal-details['inquiry/list_match_count']` serves it, with the count
 * from `signals`, which only a completed screening fills.
 */
export function screeningViewOf(
  details: Details,
  signals: readonly SignalValue[] = [],
): ScreeningView {
  if (details === undefined) {
    return { kind: 'not-served' };
  }
  if (details['computed-at'] === null) {
    return { kind: 'not-computed' };
  }
  const entry = details[COUNT] as SignalDetail | undefined;
  if (entry === undefined) {
    return { kind: 'not-served' };
  }
  const screening = entry['list-screening'];
  if (screening !== undefined) {
    const value = signals.find((signal) => signal.name === COUNT)?.value;
    return { kind: 'screening', screening, count: typeof value === 'number' ? value : null };
  }
  if (entry['null-reason'] === 'no_lists_selected') {
    return { kind: 'no-lists' };
  }
  return entry['null-reason'] === 'list_screening_pending'
    ? { kind: 'pending' }
    : { kind: 'not-served' };
}

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

const listLink = (id: string, linked: boolean) =>
  linked ? (
    <Link href={`/lists/${id}`} className={LINK_CLASS}>
      {code(id)}
    </Link>
  ) : (
    code(id)
  );

function ScreeningBody({
  view,
  listsLinked,
}: {
  readonly view: ScreeningView;
  readonly listsLinked: boolean;
}) {
  switch (view.kind) {
    case 'not-served':
      return <p className="text-sm text-ink-muted">This server reports no list screening.</p>;
    case 'not-computed':
      return (
        <p className="text-sm">
          Not screened yet: the screening runs when the inquiry completes, fails or expires.
        </p>
      );
    case 'no-lists':
      return <p className="text-sm">No list is selected for screening.</p>;
    case 'pending':
      return <p className="text-sm">{LIST_SCREENING_STATUS_WORDS.pending}.</p>;
    case 'screening': {
      const { screening } = view;
      const selected = [
        ...screening.unscreened.map((entry) => ({
          id: entry['list-id'],
          words: `Not screened: ${LIST_UNSCREENED_REASON_WORDS[entry.reason]}`,
        })),
        ...screening['not-applicable'].map((entry) => ({
          id: entry['list-id'],
          words: capitalise(LIST_NOT_APPLICABLE_REASON_WORDS[entry.reason]),
        })),
      ];
      const status =
        screening.status === 'completed' && view.count !== null
          ? `${LIST_SCREENING_STATUS_WORDS.completed}: ${String(view.count)} open ${view.count === 1 ? 'match' : 'matches'}`
          : LIST_SCREENING_STATUS_WORDS[screening.status];
      return (
        <>
          <p className="text-sm">{status}.</p>
          {selected.length > 0 && (
            <ul aria-label="Selected lists" className="flex flex-col gap-1 text-sm">
              {selected.map((entry) => (
                <li key={`${entry.id}-${entry.words}`}>
                  {listLink(entry.id, listsLinked)}: {entry.words}
                </li>
              ))}
            </ul>
          )}
          {screening['review-cause'] !== null && (
            <p className="text-sm">{LIST_REVIEW_CAUSE_WORDS[screening['review-cause']]}.</p>
          )}
        </>
      );
    }
  }
}

const capitalise = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** C99.4: the screening's state, in words. */
export function ListScreening({
  view,
  listsLinked,
  id = 'inquiry-list-screening',
}: {
  readonly view: ScreeningView;
  readonly listsLinked: boolean;
  readonly id?: string;
}) {
  return (
    <CardPart id={id} title="List screening">
      <ScreeningBody view={view} listsLinked={listsLinked} />
    </CardPart>
  );
}

export interface ListMatchesProps {
  readonly matches: readonly ListMatchResource[];
  readonly piiView: boolean;
  readonly listsLinked: boolean;
  readonly canDismiss: boolean;
  readonly dismiss: Action;
  /** The page a dismissal refreshes: `inquiry-id` or `account-id`. */
  readonly revalidate: Readonly<Record<string, string>>;
  /** Shown when there is no match. */
  readonly emptyMessage?: string;
  /** The table's caption. */
  readonly caption?: string;
}

function Evidence({ match }: { readonly match: ListMatchResource }) {
  const { attributes } = match;
  return (
    <span className="flex flex-col gap-1">
      <span>{LIST_MATCH_METHOD_WORDS[attributes.method]}</span>
      <EvidenceMeta
        tier={attributes.tier}
        beta={attributes.tier === 'H'}
        confidence={attributes.confidence}
      />
      <span className="text-xs text-ink-muted">{LIST_MATCH_TIER_WORDS[attributes.tier]}</span>
      {attributes.score !== null && (
        <span className="text-xs text-ink-muted">score {attributes.score.toFixed(2)}</span>
      )}
      {attributes['distance-meters'] !== null && (
        <span className="text-xs text-ink-muted">
          {attributes['distance-meters'].toLocaleString('en-US')} m away
        </span>
      )}
      {attributes.approximate && <span className="text-xs font-medium">approximate</span>}
    </span>
  );
}

/** C99.3: the matches, newest first as the API lists them, with dismissal for `lists:write`. */
export function ListMatches({
  matches,
  piiView,
  listsLinked,
  canDismiss,
  dismiss,
  revalidate,
  emptyMessage = 'No list match for this inquiry.',
  caption = 'List matches of this inquiry',
}: ListMatchesProps) {
  if (matches.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyMessage}</p>;
  }
  const masked = !piiView;
  const columns: Column<ListMatchResource>[] = [
    { id: 'id', header: 'Match', rowHeader: true, cell: (match) => code(match.id) },
    {
      id: 'list',
      header: 'List',
      cell: (match) => (
        <span className="flex flex-col">
          {listLink(match.relationships.list.data.id, listsLinked)}
          <span className="text-xs text-ink-muted">version {match.attributes['list-version']}</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (match) => LIST_MATCH_STATUS_WORDS[match.attributes.status],
    },
    {
      id: 'source',
      header: 'Compared value',
      cell: (match) => (
        <span className="flex flex-col">
          <span>{LIST_PROBE_SOURCE_WORDS[match.attributes.source]}</span>
          <span className="break-all">
            <MaskedValue value={match.attributes['matched-value']} masked={masked} />
          </span>
        </span>
      ),
    },
    { id: 'evidence', header: 'Evidence', cell: (match) => <Evidence match={match} /> },
    {
      id: 'found',
      header: 'Found (UTC)',
      cell: (match) => <Timestamp value={match.attributes['created-at']} />,
    },
    {
      id: 'dismissal',
      header: 'Dismissal',
      cell: (match) =>
        match.attributes.status === 'dismissed' ? (
          <span className="flex flex-col">
            {match.attributes['dismissed-at'] === null ? (
              <EmptyValue />
            ) : (
              <Timestamp value={match.attributes['dismissed-at']} />
            )}
            <span className="break-words">
              <MaskedValue value={match.attributes.reason} masked={masked} />
            </span>
          </span>
        ) : (
          <EmptyValue />
        ),
    },
  ];
  if (canDismiss) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (match) =>
        match.attributes.status === 'open' ? (
          <DismissListMatchButton matchId={match.id} action={dismiss} fields={revalidate} />
        ) : null,
    });
  }
  // C92.8: a match on an IP location (a country or a point) shows a place from DB-IP.
  const ipLocated = matches.some((match) => IP_LOCATION_SOURCES.has(match.attributes.source));
  return (
    <div className="flex flex-col gap-3">
      <DataTable
        caption={caption}
        captionHidden
        columns={columns}
        rows={matches}
        getRowKey={(match) => match.id}
        emptyMessage={emptyMessage}
      />
      {ipLocated && <DbIpAttribution />}
    </div>
  );
}

const IP_LOCATION_SOURCES: ReadonlySet<string> = new Set([
  'session.ip-country',
  'session.ip-point',
]);
