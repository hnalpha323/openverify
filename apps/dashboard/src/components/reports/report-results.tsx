/**
 * What each report type found (C79-C82, C86), exactly as the API served it:
 * - watchlist and business watchlist: the matched lists with their entries, each with the other
 *   lists it is on and their programmes, so a non-blocking listing never reads as an SDN-level
 *   block (owner decision 9);
 * - crypto address watchlist: the listed addresses, the address format, the exposure block and
 *   each entry's other lists;
 * - PEP: each person with positions and relatives, a relative's class of the PEP it relates to
 *   (owner decision 9), and the Wikidata sources as plain links;
 * - adverse media: the articles as plain links only (the title is link text; nothing is
 *   fetched, previewed or embedded, decision 8), each with its confidence and beta stage;
 * - email, phone and address: every field, an unavailable one with its reason in words, an
 *   H-tier level with its confidence, reasons and beta stage, and the domain kind beside a
 *   masked domain (P15);
 * - IP address: the same, each field's tier, confidence (H only), reasons and beta stage from
 *   `field-details`, "approximate" on what the address implies, and the DB-IP line beside a place
 *   it gave (C92.8, C106.1);
 * - custom list: each matched item with its method, tier and evidence, and every list searched,
 *   an unscreened one "not screened" with its reason (C106.2).
 * Personal values the API masked show as "Hidden", redacted ones as "Redacted".
 */
import { PII_REPORT_ATTRIBUTES, type SignalEvidenceReason } from '@openverify/contracts';
import { useId, type ReactNode } from 'react';
import type { Report } from '../../lib/report-documents';
import {
  ADVERSE_MEDIA_CATEGORY_LABELS,
  EMAIL_REPUTATION_REASON_WORDS,
  LIST_MEMBERSHIPS_NOTE,
  PHONE_RISK_REASON_WORDS,
  fieldValueWords,
  listMembershipText,
  relativeClassText,
  reportFieldLabel,
  type EmailReputationReason,
  type FieldReportType,
  type ListMembership,
  type PhoneRiskReason,
} from '../../lib/report-field-words';
import { REPORT_MATCH_TYPE_WORDS } from '../../lib/report-match-words';
import { SIGNAL_EVIDENCE_REASON_WORDS } from '../../lib/signal-words';
import {
  REPORT_UNAVAILABLE_REASON_WORDS,
  type ReportUnavailableReason,
} from '../../lib/report-words';
import type {
  ListMatchMethod,
  ListMatchTier,
  ListNotApplicableReason,
  ListProbeSource,
  ListUnscreenedReason,
  ReportMatchType,
} from '@openverify/core';
import {
  LIST_MATCH_METHOD_WORDS,
  LIST_MATCH_TIER_WORDS,
  LIST_NOT_APPLICABLE_REASON_WORDS,
  LIST_PROBE_SOURCE_WORDS,
  LIST_UNSCREENED_REASON_WORDS,
} from '../../lib/list-match-words';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { HiddenValue } from '../hidden-value';
import { LINK_CLASS } from '../link-styles';
import { PageSection } from '../lifecycle/page-section';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue } from '../masked-value';
import { StageBadge } from './report-badges';
import { DbIpAttribution } from '../signals/db-ip-attribution';
import { EvidenceMeta, ReasonList } from '../signals/evidence';
import { Code, TimeOrNone, type PiiState } from './report-parts';
import { typeOf } from './report-summary';

type Attributes = Readonly<Record<string, unknown>>;
const PII: ReadonlySet<string> = new Set(PII_REPORT_ATTRIBUTES);

/** A value the API left `null`: masked, redacted, or simply not there. */
function Missing({ state, pii }: { readonly state: PiiState; readonly pii: boolean }) {
  if (pii && state === 'redacted') {
    return <RedactedValue />;
  }
  return pii && state === 'hidden' ? <HiddenValue /> : <EmptyValue />;
}

const words = (field: string, value: string) => fieldValueWords(field, value) ?? value;
const joined = (items: readonly string[]) =>
  items.length === 0 ? <EmptyValue /> : items.join(', ');

interface Birthdate {
  readonly day: number | null;
  readonly month: number | null;
  readonly year: number | null;
  readonly granularity: 'day' | 'month' | 'year';
}

const two = (value: number | null) => String(value ?? 0).padStart(2, '0');

/** `YYYY-MM-DD`, `YYYY-MM` or `YYYY`, by granularity. */
function birthdateText(date: Birthdate): string {
  const year = date.year === null ? '????' : String(date.year);
  if (date.granularity === 'year') {
    return year;
  }
  return date.granularity === 'month'
    ? `${year}-${two(date.month)}`
    : `${year}-${two(date.month)}-${two(date.day)}`;
}

// ---------------------------------------------------------------------------------------------
// Matched lists (watchlist, business watchlist)

interface ListEntity {
  readonly 'entity-id': string;
  readonly name: string;
  readonly 'alias-type': string;
  readonly 'match-types': readonly ReportMatchType[];
  readonly score: number;
  readonly countries: readonly string[];
  readonly programs: readonly string[];
  readonly birthdates?: readonly Birthdate[];
  readonly kind?: string;
  readonly identifiers?: readonly {
    readonly kind: string;
    readonly value: string;
    readonly country: string | null;
  }[];
  readonly 'list-memberships'?: readonly ListMembership[];
}

/** An entry's other lists in words, or "None" when it carries none (owner decision 9). */
const otherLists = (memberships: readonly ListMembership[] | undefined) =>
  joined((memberships ?? []).map(listMembershipText));

const carriesMemberships = (entities: readonly { readonly 'list-memberships'?: unknown }[]) =>
  entities.some((entity) => entity['list-memberships'] !== undefined);

function MembershipsNote() {
  return <p className="text-xs text-ink-muted">{LIST_MEMBERSHIPS_NOTE}</p>;
}

interface MatchedList {
  readonly 'source-id': string;
  readonly name: string;
  readonly 'list-type': string;
  readonly 'flag-code': string;
  readonly entities: readonly ListEntity[];
}

function entityColumns(business: boolean): readonly Column<ListEntity>[] {
  return [
    { id: 'name', header: 'Name', rowHeader: true, cell: (entity) => entity.name },
    { id: 'alias', header: 'Alias', cell: (entity) => words('alias-type', entity['alias-type']) },
    ...(business
      ? [
          {
            id: 'kind',
            header: 'Kind',
            cell: (entity: ListEntity) => words('kind', entity.kind ?? ''),
          },
          {
            id: 'identifiers',
            header: 'Identifiers',
            cell: (entity: ListEntity) =>
              joined(
                (entity.identifiers ?? []).map(
                  (identifier) =>
                    `${words('identifier', identifier.kind)} ${identifier.value}${identifier.country === null ? '' : ` (${identifier.country})`}`,
                ),
              ),
          },
        ]
      : [
          {
            id: 'birthdates',
            header: 'Birth dates',
            cell: (entity: ListEntity) => joined((entity.birthdates ?? []).map(birthdateText)),
          },
        ]),
    { id: 'countries', header: 'Countries', cell: (entity) => joined(entity.countries) },
    { id: 'programs', header: 'Programmes', cell: (entity) => joined(entity.programs) },
    {
      id: 'other-lists',
      header: 'Other lists',
      cell: (entity) => otherLists(entity['list-memberships']),
    },
    {
      id: 'types',
      header: 'Match types',
      cell: (entity) => joined(entity['match-types'].map((type) => REPORT_MATCH_TYPE_WORDS[type])),
    },
    { id: 'score', header: 'Score', cell: (entity) => entity.score.toFixed(2) },
  ];
}

function MatchedLists({ report, state }: { readonly report: Report; readonly state: PiiState }) {
  const attributes = report.attributes as Attributes;
  const lists = attributes['matched-lists'] as readonly MatchedList[] | null;
  const business = report.type === 'report/business-watchlist';
  const searched = attributes['lists-searched'] as readonly string[] | undefined;
  return (
    <PageSection id="report-matched-lists" title="Matched lists">
      {searched !== undefined && (
        <dl>
          <Detail term="Lists searched">{joined(searched)}</Detail>
        </dl>
      )}
      {lists === null ? (
        <p>
          <Missing state={state} pii />
        </p>
      ) : lists.length === 0 ? (
        <p className="text-sm text-ink-muted">None recorded.</p>
      ) : (
        lists.map((list) => (
          <div key={list['source-id']} className="flex flex-col gap-2">
            <h3 className="text-base font-semibold">
              {list.name} ({list['flag-code']}, {words('list-type', list['list-type'])})
            </h3>
            <DataTable
              caption={`Entries of ${list.name}`}
              captionHidden
              columns={entityColumns(business)}
              rows={list.entities}
              getRowKey={(entity) => entity['entity-id']}
              emptyMessage="None recorded."
            />
          </div>
        ))
      )}
      {lists !== null && carriesMemberships(lists.flatMap((list) => list.entities)) && (
        <MembershipsNote />
      )}
    </PageSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Crypto address watchlist

interface CryptoAddress {
  readonly type: string;
  readonly address: string;
  readonly chain: string;
}
interface CryptoEntity {
  readonly 'entity-id': string;
  readonly name: string;
  readonly 'crypto-addresses': readonly CryptoAddress[];
  readonly 'list-memberships'?: readonly ListMembership[];
}
interface CryptoList {
  readonly 'source-id': string;
  readonly entities: readonly CryptoEntity[];
}
interface Exposure {
  readonly 'direct-sanctioned': boolean;
  readonly exposures: readonly {
    readonly category: string;
    readonly share: number;
    readonly hops: number;
  }[];
  readonly 'risk-score': number | null;
}

const ADDRESS_COLUMNS: readonly Column<CryptoAddress>[] = [
  { id: 'address', header: 'Address', rowHeader: true, cell: (row) => <Code>{row.address}</Code> },
  { id: 'type', header: 'Ticker', cell: (row) => row.type },
  { id: 'chain', header: 'Chain', cell: (row) => <Code>{row.chain}</Code> },
];

/** A field the run left `null` and listed with its reason (C69.4). */
function unavailableReason(report: Report, field: string): ReportUnavailableReason | undefined {
  return report.attributes['unavailable-fields'].find((entry) => entry.field === field)?.reason;
}

function Unavailable({ reason }: { readonly reason: ReportUnavailableReason }) {
  return <>Unavailable: {REPORT_UNAVAILABLE_REASON_WORDS[reason]}</>;
}

interface CustomListItem {
  readonly 'list-item': { readonly id: string };
  readonly source: ListProbeSource;
  readonly method: ListMatchMethod;
  readonly tier: ListMatchTier;
  readonly confidence: number | null;
  readonly approximate: boolean;
  readonly score: number | null;
  readonly 'distance-meters': number | null;
  readonly 'matched-value': string | null;
}

interface CustomListMatched {
  readonly 'list-id': string;
  readonly name: string;
  readonly version: number;
  readonly items: readonly CustomListItem[];
}

interface ListEntry {
  readonly 'list-id': string;
  readonly reason: string;
}

function customListColumns(state: PiiState): readonly Column<CustomListItem>[] {
  return [
    {
      id: 'item',
      header: 'Item',
      rowHeader: true,
      cell: (item) => <Code>{item['list-item'].id}</Code>,
    },
    { id: 'source', header: 'Compared', cell: (item) => LIST_PROBE_SOURCE_WORDS[item.source] },
    {
      id: 'evidence',
      header: 'Evidence',
      cell: (item) => (
        <span className="flex flex-col gap-1">
          <span>{LIST_MATCH_METHOD_WORDS[item.method]}</span>
          <EvidenceMeta tier={item.tier} beta={item.tier === 'H'} confidence={item.confidence} />
          <span className="text-xs text-ink-muted">{LIST_MATCH_TIER_WORDS[item.tier]}</span>
          {item.score !== null && (
            <span className="text-xs text-ink-muted">score {item.score.toFixed(2)}</span>
          )}
          {item['distance-meters'] !== null && (
            <span className="text-xs text-ink-muted">
              {item['distance-meters'].toLocaleString('en-US')} m away
            </span>
          )}
          {item.approximate && <span className="text-xs font-medium">approximate</span>}
        </span>
      ),
    },
    {
      id: 'value',
      header: 'Value compared',
      cell: (item) =>
        item['matched-value'] === null ? (
          <Missing state={state} pii />
        ) : (
          <span className="break-all">{item['matched-value']}</span>
        ),
    },
  ];
}

const capitalise = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** C106.2: how the run met each list it searched; never "no match" for a list it could not read. */
function listsSearchedWords(attributes: Attributes) {
  const unscreened = new Map(
    (attributes.unscreened as readonly ListEntry[]).map((entry) => [
      entry['list-id'],
      entry.reason,
    ]),
  );
  const notApplicable = new Map(
    (attributes['not-applicable'] as readonly ListEntry[]).map((entry) => [
      entry['list-id'],
      entry.reason,
    ]),
  );
  return (attributes['lists-searched'] as readonly string[]).map((id) => {
    const reason = unscreened.get(id);
    if (reason !== undefined) {
      return {
        id,
        words: `Not screened: ${LIST_UNSCREENED_REASON_WORDS[reason as ListUnscreenedReason]}`,
      };
    }
    const none = notApplicable.get(id);
    return none !== undefined
      ? {
          id,
          words: capitalise(LIST_NOT_APPLICABLE_REASON_WORDS[none as ListNotApplicableReason]),
        }
      : { id, words: 'Screened' };
  });
}

/**
 * C106.2 (C108): the lists a run matched, each item with the value compared, its method, tier,
 * confidence or score or distance, and "approximate"; then every list it searched: screened, not
 * screened with its reason, or with no value to compare.
 */
function CustomListResults({
  report,
  state,
}: {
  readonly report: Report;
  readonly state: PiiState;
}) {
  const attributes = report.attributes as Attributes;
  const lists = attributes['matched-lists'] as readonly CustomListMatched[] | null;
  const columns = customListColumns(state);
  const searched = listsSearchedWords(attributes);
  return (
    <>
      <PageSection id="report-matched-lists" title="Matched lists">
        {lists === null ? (
          <p>
            <Missing state={state} pii />
          </p>
        ) : lists.length === 0 ? (
          <p className="text-sm text-ink-muted">None recorded.</p>
        ) : (
          lists.map((list) => (
            <div key={list['list-id']} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">
                {list.name}{' '}
                <span className="text-sm font-normal text-ink-muted">
                  <Code>{list['list-id']}</Code>, version {list.version}
                </span>
              </h3>
              <DataTable
                caption={`Items of ${list.name}`}
                captionHidden
                columns={columns}
                rows={list.items}
                getRowKey={(item) => item['list-item'].id}
                emptyMessage="None recorded."
              />
            </div>
          ))
        )}
      </PageSection>
      <PageSection
        id="report-lists-searched"
        title="Lists searched"
        description="A list the run could not read errors the report; a list the query had no value for was screened with nothing to compare."
      >
        {searched.length === 0 ? (
          <p className="text-sm text-ink-muted">None recorded.</p>
        ) : (
          <ul aria-label="Lists searched" className="flex flex-col gap-1 text-sm">
            {searched.map((entry) => (
              <li key={entry.id}>
                <Code>{entry.id}</Code>: {entry.words}
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </>
  );
}

function ExposureBlock({ report, state }: { readonly report: Report; readonly state: PiiState }) {
  const exposure = (report.attributes as Attributes).exposure as Exposure | null;
  const reason = unavailableReason(report, 'exposure');
  if (reason !== undefined) {
    return <Unavailable reason={reason} />;
  }
  if (exposure === null) {
    return <Missing state={state} pii />;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      <li>Directly sanctioned: {exposure['direct-sanctioned'] ? 'Yes' : 'No'}</li>
      {exposure.exposures.map((item) => (
        <li key={`${item.category}:${String(item.hops)}`}>
          {item.category}: {Math.round(item.share * 100)}%{' '}
          {item.hops === 0 ? 'directly' : `at ${String(item.hops)} hop or more`}
        </li>
      ))}
      <li>
        Risk score:{' '}
        {exposure['risk-score'] === null
          ? 'not computed (no score is synthesised)'
          : exposure['risk-score'].toFixed(2)}
      </li>
    </ul>
  );
}

function CryptoResults({ report, state }: { readonly report: Report; readonly state: PiiState }) {
  const attributes = report.attributes as Attributes;
  const lists = attributes.result as readonly CryptoList[] | null;
  const format = attributes['crypto-address-format'] as string | null;
  return (
    <PageSection id="report-crypto" title="Listed crypto addresses">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Detail term="Address format">
          {format === null ? <EmptyValue /> : words('crypto-address-format', format)}
        </Detail>
        <Detail term="Exposure">
          <ExposureBlock report={report} state={state} />
        </Detail>
      </dl>
      {lists === null ? (
        <p>
          <Missing state={state} pii />
        </p>
      ) : lists.flatMap((list) => list.entities).length === 0 ? (
        <p className="text-sm text-ink-muted">None recorded.</p>
      ) : (
        lists.flatMap((list) =>
          list.entities.map((entity) => (
            <div key={entity['entity-id']} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{entity.name}</h3>
              {entity['list-memberships'] !== undefined && (
                <dl>
                  <Detail term={`Other lists of ${entity.name}`}>
                    {otherLists(entity['list-memberships'])}
                  </Detail>
                </dl>
              )}
              <DataTable
                caption={`Addresses of ${entity.name}`}
                captionHidden
                columns={ADDRESS_COLUMNS}
                rows={entity['crypto-addresses']}
                getRowKey={(row) => `${row.address}:${row.type}`}
                emptyMessage="None recorded."
              />
            </div>
          )),
        )
      )}
      {lists !== null && carriesMemberships(lists.flatMap((list) => list.entities)) && (
        <MembershipsNote />
      )}
    </PageSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Politically exposed persons

interface Position {
  readonly position: string;
  readonly 'pep-class': number | null;
  readonly country: string | null;
  readonly start: string | null;
  readonly end: string | null;
  readonly 'in-office': string;
  readonly 'source-key': string;
}
interface PepEntity {
  readonly 'entity-id': string;
  readonly name: string;
  readonly birthdates: readonly Birthdate[];
  readonly country: string | null;
  readonly sex: string | null;
  readonly 'match-types': readonly ReportMatchType[];
  readonly 'pep-type': string;
  readonly score: number;
  readonly positions: readonly Position[];
  readonly associates: readonly { readonly name: string; readonly relationship: string }[];
  readonly sources: Readonly<Record<string, string>>;
  readonly 'relative-of-class'?: number;
}

const POSITION_COLUMNS: readonly Column<Position>[] = [
  { id: 'position', header: 'Position', rowHeader: true, cell: (row) => row.position },
  {
    id: 'class',
    header: 'Class',
    cell: (row) => (row['pep-class'] === null ? <EmptyValue /> : String(row['pep-class'])),
  },
  { id: 'country', header: 'Country', cell: (row) => row.country ?? <EmptyValue /> },
  { id: 'start', header: 'Start', cell: (row) => row.start ?? <EmptyValue /> },
  {
    id: 'end',
    header: 'End',
    cell: (row) =>
      row.end === null ? <EmptyValue /> : row.end === 'unknown' ? 'Unknown' : row.end,
  },
  { id: 'office', header: 'In office', cell: (row) => words('in-office', row['in-office']) },
];

/** A plain link out of the console: never fetched, previewed or embedded (decision 8). */
function OutLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} rel="noopener noreferrer nofollow" target="_blank" className={LINK_CLASS}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function PepPerson({ entity }: { readonly entity: PepEntity }) {
  const headingId = useId();
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {entity.name}
      </h3>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail term="Type">{words('pep-type', entity['pep-type'])}</Detail>
        {entity['pep-type'] === 'relative' && (
          <Detail term="Class of the related PEP">
            {relativeClassText(entity['relative-of-class'])}
          </Detail>
        )}
        <Detail term="Country">{entity.country ?? <EmptyValue />}</Detail>
        <Detail term="Sex">
          {entity.sex === null ? <EmptyValue /> : words('sex', entity.sex)}
        </Detail>
        <Detail term="Birth dates">{joined(entity.birthdates.map(birthdateText))}</Detail>
        <Detail term="Match types">
          {joined(entity['match-types'].map((type) => REPORT_MATCH_TYPE_WORDS[type]))}
        </Detail>
        <Detail term="Score">{entity.score.toFixed(2)}</Detail>
        <Detail term="Relatives">
          {joined(
            entity.associates.map(
              (associate) => `${associate.name} (${words('relationship', associate.relationship)})`,
            ),
          )}
        </Detail>
        <Detail term="Sources">
          {Object.keys(entity.sources).length === 0 ? (
            <EmptyValue />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {Object.entries(entity.sources).map(([qid, url]) => (
                <li key={qid}>
                  <OutLink href={url}>{qid}</OutLink>
                </li>
              ))}
            </ul>
          )}
        </Detail>
      </dl>
      <DataTable
        caption={`Positions of ${entity.name}`}
        captionHidden
        columns={POSITION_COLUMNS}
        rows={entity.positions}
        getRowKey={(row) => `${row['source-key']}:${row.start ?? ''}`}
        emptyMessage="No position: a relative holds none of their own."
      />
    </article>
  );
}

function PepResults({ report, state }: { readonly report: Report; readonly state: PiiState }) {
  const people = (report.attributes as Attributes).result as readonly PepEntity[] | null;
  return (
    <PageSection id="report-pep" title="Politically exposed persons">
      {people === null ? (
        <p>
          <Missing state={state} pii />
        </p>
      ) : people.length === 0 ? (
        <p className="text-sm text-ink-muted">None recorded.</p>
      ) : (
        people.map((entity) => <PepPerson key={entity['entity-id']} entity={entity} />)
      )}
    </PageSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Adverse media

interface Article {
  readonly 'entity-id': string;
  readonly url: string;
  readonly domain: string;
  readonly 'seen-date': string;
  readonly language: string;
  readonly 'source-country': string | null;
  readonly title: string;
  readonly categories: readonly (keyof typeof ADVERSE_MEDIA_CATEGORY_LABELS)[];
  readonly 'match-types': readonly ReportMatchType[];
  readonly score: number;
  readonly confidence: number;
}

const LANGUAGES = new Intl.DisplayNames(['en'], { type: 'language' });

/** A language code in words; GDELT's unknown language is served as `und` (BCP 47). */
function languageText(code: string): string {
  if (code === 'und') {
    return 'Undetermined';
  }
  try {
    return LANGUAGES.of(code) ?? code;
  } catch {
    return code;
  }
}

function MediaResults({ report, state }: { readonly report: Report; readonly state: PiiState }) {
  const attributes = report.attributes as Attributes;
  const articles = attributes.articles as readonly Article[] | null;
  const citation = attributes.citation as string | null;
  return (
    <PageSection
      id="report-articles"
      title="Articles"
      description="Each article is a link only: the console never fetches, previews or embeds it."
    >
      {articles === null ? (
        <p>
          <Missing state={state} pii />
        </p>
      ) : articles.length === 0 ? (
        <p className="text-sm text-ink-muted">None recorded.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {articles.map((article) => (
            <li
              key={article['entity-id']}
              className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
            >
              <OutLink href={article.url}>{article.title}</OutLink>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Detail term="Domain">{article.domain}</Detail>
                <Detail term="Seen (UTC)">
                  <TimeOrNone value={article['seen-date']} />
                </Detail>
                <Detail term="Language">{languageText(article.language)}</Detail>
                <Detail term="Source country">{article['source-country'] ?? <EmptyValue />}</Detail>
                <Detail term="Categories">
                  {joined(
                    article.categories.map((category) => ADVERSE_MEDIA_CATEGORY_LABELS[category]),
                  )}
                </Detail>
                <Detail term="Match types">
                  {joined(article['match-types'].map((type) => REPORT_MATCH_TYPE_WORDS[type]))}
                </Detail>
                <Detail term="Score">{article.score.toFixed(2)}</Detail>
                <Detail term="Confidence">
                  <span className="inline-flex items-center gap-2">
                    {article.confidence.toFixed(2)} <StageBadge stage="beta" />
                  </span>
                </Detail>
              </dl>
            </li>
          ))}
        </ul>
      )}
      {citation !== null && <p className="text-xs text-ink-muted">{citation}</p>}
    </PageSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Email, phone and address

/** The fields shown inside another (a level with its confidence and reasons). */
const FOLDED: ReadonlySet<string> = new Set([
  'email-reputation-confidence',
  'email-reputation-reasons',
  'phone-risk-confidence',
  'phone-risk-reasons',
]);

/** An H-tier level (C82): its value, confidence, reasons and beta stage. */
function Level({
  value,
  confidence,
  reasons,
}: {
  readonly value: string;
  readonly confidence: number | null;
  readonly reasons: readonly string[];
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex flex-wrap items-center gap-2">
        {value}
        {confidence !== null && <span>Confidence {confidence.toFixed(2)}</span>}
        <StageBadge stage="beta" />
      </span>
      {reasons.length > 0 && (
        <ul className="flex list-disc flex-col gap-0.5 ps-5">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </span>
  );
}

function FieldValue({
  report,
  field,
  state,
}: {
  readonly report: Report;
  readonly field: string;
  readonly state: PiiState;
}) {
  const attributes = report.attributes as Attributes;
  const value = attributes[field];
  const reason = unavailableReason(report, field);
  if (reason !== undefined) {
    return <Unavailable reason={reason} />;
  }
  if (value === null || value === undefined) {
    return <Missing state={state} pii={PII.has(field)} />;
  }
  if (field === 'email-reputation' && typeof value === 'string') {
    return (
      <Level
        value={words(field, value)}
        confidence={attributes['email-reputation-confidence'] as number | null}
        reasons={(attributes['email-reputation-reasons'] as readonly EmailReputationReason[]).map(
          (each) => EMAIL_REPUTATION_REASON_WORDS[each],
        )}
      />
    );
  }
  if (field === 'phone-risk-level' && typeof value === 'string') {
    return (
      <Level
        value={words(field, value)}
        confidence={attributes['phone-risk-confidence'] as number | null}
        reasons={(attributes['phone-risk-reasons'] as readonly PhoneRiskReason[]).map(
          (each) => PHONE_RISK_REASON_WORDS[each],
        )}
      />
    );
  }
  if (typeof value === 'boolean') {
    return <>{fieldValueWords(field, String(value)) ?? (value ? 'Yes' : 'No')}</>;
  }
  if (Array.isArray(value)) {
    return joined((value as readonly string[]).map((item) => words(field, item)));
  }
  if (typeof value === 'number') {
    return <>{String(value)}</>;
  }
  return <>{typeof value === 'string' ? words(field, value) : JSON.stringify(value)}</>;
}

/** C92.8: an ip-address result showing a place DB-IP gave. */
const IP_LOCATION_FIELDS = ['country-code', 'city', 'region', 'latitude', 'longitude'] as const;
const showsIpLocation = (report: Report) =>
  IP_LOCATION_FIELDS.some((field) => {
    const value = (report.attributes as Attributes)[field];
    return value !== null && value !== undefined;
  });

/** What a run read from the address's network data: a place or network is never exact. */
const IP_APPROXIMATE_FIELDS: ReadonlySet<string> = new Set([
  'isp',
  'country-name',
  ...IP_LOCATION_FIELDS,
]);

/** C106.1: a field's entry in `field-details`; only H carries a confidence. */
interface IpFieldDetail {
  readonly tier: string;
  readonly confidence?: number | null;
  readonly reasons: readonly SignalEvidenceReason[];
}

/** A field's tier, beta stage, confidence and reasons, and "approximate" on a value it shows. */
function IpFieldEvidence({ report, field }: { readonly report: Report; readonly field: string }) {
  const attributes = report.attributes as Attributes;
  const details = attributes['field-details'] as Readonly<Record<string, IpFieldDetail>>;
  const detail = details[field];
  const value = attributes[field];
  return (
    <>
      {detail !== undefined && (
        <span className="mt-1 flex flex-col gap-1">
          <EvidenceMeta
            tier={detail.tier}
            beta={detail.tier === 'H'}
            confidence={detail.confidence}
          />
          <ReasonList
            reasons={detail.reasons.map((reason) => SIGNAL_EVIDENCE_REASON_WORDS[reason])}
          />
        </span>
      )}
      {IP_APPROXIMATE_FIELDS.has(field) && value !== null && value !== undefined && (
        <span className="block text-xs font-medium">
          {SIGNAL_EVIDENCE_REASON_WORDS.approximate}
        </span>
      )}
    </>
  );
}

function FieldResults({
  report,
  type,
  state,
}: {
  readonly report: Report;
  readonly type: FieldReportType;
  readonly state: PiiState;
}) {
  const fields = Object.keys(report.attributes).filter(
    (field) => reportFieldLabel(type, field) !== undefined && !FOLDED.has(field),
  );
  return (
    <PageSection
      id="report-fields"
      title="Fields"
      description="A field nobody could compute is unavailable with its reason, never false."
    >
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {fields.map((field) => (
          <Detail key={field} term={reportFieldLabel(type, field)}>
            <FieldValue report={report} field={field} state={state} />
            {type === 'ip-address' && <IpFieldEvidence report={report} field={field} />}
          </Detail>
        ))}
      </dl>
      {type === 'ip-address' && showsIpLocation(report) && <DbIpAttribution />}
    </PageSection>
  );
}

/** What the report's type found, by type. */
export function ReportTypeResults({
  report,
  state,
}: {
  readonly report: Report;
  readonly state: PiiState;
}) {
  const type = typeOf(report);
  switch (type) {
    case 'watchlist':
    case 'business-watchlist':
      return <MatchedLists report={report} state={state} />;
    case 'crypto-address-watchlist':
      return <CryptoResults report={report} state={state} />;
    case 'politically-exposed-person':
      return <PepResults report={report} state={state} />;
    case 'adverse-media':
    case 'business-adverse-media':
      return <MediaResults report={report} state={state} />;
    case 'email-address':
    case 'phone-number':
    case 'address-lookup':
    case 'ip-address':
      return <FieldResults report={report} type={type} state={state} />;
    case 'custom-list':
      return <CustomListResults report={report} state={state} />;
  }
}
