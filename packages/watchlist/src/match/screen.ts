/**
 * C78.4, C78.5, C79.1, C79.2: screening a subject against candidate list entries. For each entry
 * whose kind the subject may meet: the best name score over every (subject name, strong list name)
 * pair; the qualifiers when that score reaches 0.70; an exact identifier of the same kind (and
 * country, when both state one) makes a match whatever the names say, at the higher of the score
 * and 0.95 (H06); with `screen-weak-aliases`, a weak alias equal to a subject name makes a match
 * only when `dob_exact` holds or an identifier agrees, at 0.90, under every preset (H10); weak
 * aliases are never fuzzy-matched. Below 0.70 nothing is returned; a match is created at the
 * preset's minimum (`exact`: on equality). Persons meet individuals; businesses meet the template's
 * `entity-kinds`, and a query's IMO, MMSI or aircraft identifier also meets vessels and aircraft
 * by that identifier alone.
 */
import {
  qualifierAdjustment,
  REPORT_MATCH_QUALIFIERS as QUALIFIERS,
  REPORT_MATCH_TYPES,
  SCREENING_CONSTANTS,
  type BirthdateMatchingMode,
  type BusinessCountryField,
  type BusinessEntityKind,
  type PersonCountryField,
  type ReportFilterMode,
  type ReportMatchQualifier,
  type ReportMatchType,
} from '@openverify/core';
import {
  recordIdentifierRows,
  type IdentifierKind,
  type NormalisedIdentifier,
  type VariantGroups,
} from '../keys/index.js';
import { analyseRecordName, namesExactlyEqual, type AnalysedName } from '../names/index.js';
import type { COUNTRY_ROLES, WatchlistRecord } from '../record/index.js';
import {
  qualify,
  scoreNamePair,
  scoreNamePairAbove,
  type NameScore,
  type PairMemo,
  type ResolvedNameMatching,
} from '../score/index.js';
import { entryKey } from './evidence.js';
import { screeningShortcutEnabled } from './shortcuts.js';
import type { ScreeningSubject } from './subject.js';

/** A template's matching configuration, resolved (C79.1, C79.2, C80.5). */
export interface ScreeningOptions {
  readonly nameMatching: ResolvedNameMatching;
  readonly birthdateMatching: BirthdateMatchingMode;
  readonly birthdateFilter: ReportFilterMode;
  readonly countryFields: readonly (PersonCountryField | BusinessCountryField)[];
  readonly countryFilter: ReportFilterMode;
  readonly screenWeakAliases: boolean;
  /** Businesses only; `['entity']` by default. */
  readonly entityKinds?: readonly BusinessEntityKind[] | undefined;
  /** PEP (C80.5). */
  readonly keepWithoutBirthdate?: boolean | undefined;
  readonly groups: VariantGroups;
  /**
   * Owner decision 1 after 6B: return only the matches that are created (`aboveMinimum`), which is
   * all a run and a re-screen keep, so the scorer may stop at the preset's minimum (`minimum-floor`).
   */
  readonly keptOnly?: boolean | undefined;
}

/** One list entry `retrieveCandidates` or `loadEntries` returned. */
export interface ScreeningCandidate {
  readonly sourceId: string;
  readonly record: WatchlistRecord;
}

export type AliasType = 'primary_name' | 'aka' | 'weak_aka';

/** One entry the subject matched, with its components (C78.5; the sealed snapshot's). */
export interface EntryMatch {
  readonly sourceId: string;
  readonly entryId: string;
  /** `<source>:<publisher id>`, the readable entry key (C73.2). */
  readonly entryKey: string;
  readonly score: number;
  /** A match is created: the preset's minimum is reached, or the identifier or weak-alias rule holds. */
  readonly aboveMinimum: boolean;
  readonly matchTypes: readonly ReportMatchType[];
  readonly qualifiers: readonly ReportMatchQualifier[];
  readonly aliasType: AliasType;
  /** The matched subject name and list name as written (PII; sealed). */
  readonly subjectName: string | null;
  readonly listName: string;
  /** The name pair's score before qualifiers, and its level. */
  readonly nameScore: number;
  readonly nameLevel: 'full' | 'partial' | null;
  /** Kebab-case methods (`equal`, `typo`, `identifier-exact`, `weak-alias`, ...). */
  readonly methods: readonly string[];
  /** The name pair rests on a lossy form (C78.2). */
  readonly lossy: boolean;
}

const DISPLAY_FLOOR = SCREENING_CONSTANTS['display-floor'].value;
/** The most a qualifier can add to a name score (`dob_exact`). */
const BEST_QUALIFIER = Math.max(
  0,
  ...QUALIFIERS.map((qualifier) => qualifierAdjustment(qualifier)),
);

/**
 * The name score below which a pair cannot make a created match (owner decision 1 after 6B): the
 * preset's minimum less the best qualifier, and never below the display floor; `exact` creates a
 * match only on equality (a bound of 1).
 */
function createdFloor(matching: ResolvedNameMatching): number {
  return matching.minScore === null
    ? 1
    : Math.max(DISPLAY_FLOOR, matching.minScore - BEST_QUALIFIER);
}
const QUALIFIER_FLOOR = SCREENING_CONSTANTS['qualifier-floor'].value;
const IDENTIFIER_FLOOR = SCREENING_CONSTANTS['identifier-match-floor'].value;
const WEAK_ALIAS_SCORE = SCREENING_CONSTANTS['weak-alias-score'].value;

type CountryRole = (typeof COUNTRY_ROLES)[number];

/** The entry country roles each `country-fields` value compares (C79.1, C79.2). */
const COUNTRY_FIELD_ROLES: Readonly<
  Record<PersonCountryField | BusinessCountryField, readonly CountryRole[]>
> = {
  birthplace: ['birth'],
  citizenship: ['citizenship'],
  nationality: ['nationality'],
  residency: ['residence', 'address'],
  registration: ['registration'],
  address: ['address'],
};

/** The identifiers a query may meet vessels and aircraft by, whatever `entity-kinds` says. */
const CRAFT_IDENTIFIERS: ReadonlySet<IdentifierKind> = new Set([
  'imo',
  'mmsi',
  'aircraft_serial',
  'aircraft_tail',
]);

/** An entry's countries in the selected fields, and its PEP positions' countries. */
function entryCountries(
  record: WatchlistRecord,
  fields: readonly (PersonCountryField | BusinessCountryField)[],
): string[] {
  const roles = new Set(fields.flatMap((field) => COUNTRY_FIELD_ROLES[field]));
  const codes = record.countries.flatMap(({ code, role }) =>
    code !== null && roles.has(role) ? [code] : [],
  );
  const positions = record.positions.flatMap(({ country }) => (country === null ? [] : [country]));
  return [...new Set([...codes, ...positions])];
}

/** An exact identifier of the same kind, and of the same country when both state one (C78.4). */
function identifierAgrees(
  subject: readonly NormalisedIdentifier[],
  record: WatchlistRecord,
  kinds: ReadonlySet<IdentifierKind> | null,
): boolean {
  if (subject.length === 0) {
    return false;
  }
  const rows = recordIdentifierRows(record);
  return subject.some(
    (identifier) =>
      (kinds === null || kinds.has(identifier.kind)) &&
      rows.some(
        (row) =>
          row.kind === identifier.kind &&
          row.value === identifier.value &&
          (row.country === null ||
            identifier.country === null ||
            row.country === identifier.country),
      ),
  );
}

interface ListName {
  readonly written: WatchlistRecord['names'][number];
  readonly analysed: AnalysedName;
}

interface BestPair {
  readonly score: NameScore;
  readonly subject: AnalysedName;
  readonly list: ListName;
}

/**
 * The best (subject name, strong list name) pair, preferring an exact one on a tie. With `floor`,
 * a pair whose upper bound is below it, or below the best so far, is not aligned (C78.7): it could
 * not be returned, so the result is the same whenever the best reaches the floor.
 */
/** The name pairs one screening has bounded or scored, by subject name (`pair-memo`). */
type PairMemos = Map<AnalysedName, Map<AnalysedName, PairMemo>>;

function bestPair(
  subject: ScreeningSubject,
  strong: readonly ListName[],
  options: ScreeningOptions,
  floor: number | null,
  memos: PairMemos | null = null,
): BestPair | null {
  let best: BestPair | null = null;
  let bestScore = 0;
  let bestExact = false;
  const exactStop = screeningShortcutEnabled('exact-stop');
  for (const subjectName of subject.names) {
    let memo = memos?.get(subjectName);
    if (memos !== null && memo === undefined) {
      memo = new Map();
      memos.set(subjectName, memo);
    }
    for (const list of strong) {
      // An exact best pair at or over the floor is replaced only by a strictly higher score.
      const strict: boolean = exactStop && bestExact && floor !== null && bestScore >= floor;
      const score: NameScore | null =
        floor === null
          ? scoreNamePair(subjectName, list.analysed, options.nameMatching, options.groups)
          : scoreNamePairAbove(
              subjectName,
              list.analysed,
              options.nameMatching,
              options.groups,
              Math.max(floor, bestScore),
              { memo, strict },
            );
      if (score === null) {
        continue;
      }
      if (
        best === null ||
        score.score > best.score.score ||
        (score.score === best.score.score && score.exact && !best.score.exact)
      ) {
        best = { score, subject: subjectName, list };
        bestScore = score.score;
        bestExact = score.exact;
      }
    }
  }
  return best;
}

const NO_QUALIFICATION = Object.freeze({ qualifiers: [], adjustment: 0, dropped: false });

const primaryOf = (record: WatchlistRecord) =>
  record.names.find((name) => name.primary)?.full ?? record.names[0]?.full ?? record.entry_id;

function screenEntry(
  subject: ScreeningSubject,
  sourceId: string,
  record: WatchlistRecord,
  options: ScreeningOptions,
  byName: boolean,
  identifierKinds: ReadonlySet<IdentifierKind> | null,
  memos: PairMemos | null,
): EntryMatch | null {
  const names = record.names.map((written): ListName => ({
    written,
    analysed: analyseRecordName(written, record.kind),
  }));
  const strong = names.filter(({ written }) => written.quality === 'strong');
  const weak =
    byName && options.screenWeakAliases
      ? names.find(
          ({ written, analysed }) =>
            written.quality === 'weak' &&
            subject.names.some((name) => namesExactlyEqual(name, analysed)),
        )
      : undefined;
  const identifier = identifierAgrees(subject.identifiers, record, identifierKinds);
  const floor =
    options.keptOnly === true && screeningShortcutEnabled('minimum-floor')
      ? createdFloor(options.nameMatching)
      : DISPLAY_FLOOR;
  const pruned = byName ? bestPair(subject, strong, options, floor, memos) : null;
  // An entry another rule returns reports its name score exactly.
  const best =
    byName && (identifier || weak !== undefined) && (pruned === null || pruned.score.score < floor)
      ? bestPair(subject, strong, options, null)
      : pruned;
  const nameScore = best?.score.score ?? 0;
  const qualified = nameScore >= QUALIFIER_FLOOR;
  // Qualifiers matter only to a candidate whose name reaches the floor, or a weak alias that needs
  // `dob_exact`; any other candidate is returned by an identifier, which no filter drops, or not at all.
  const qualification =
    qualified || weak !== undefined
      ? qualify(
          {
            subjectBirthdates: subject.birthdates,
            entryBirthdates: record.birth_dates,
            subjectCountries: subject.countries,
            entryCountries: entryCountries(record, options.countryFields),
            subjectGender: subject.gender,
            entryGender: record.gender ?? null,
          },
          {
            birthdateMatching: options.birthdateMatching,
            birthdateFilter: options.birthdateFilter,
            countryFilter: options.countryFilter,
            keepWithoutBirthdate: options.keepWithoutBirthdate,
          },
        )
      : NO_QUALIFICATION;
  if (qualification.dropped && !identifier) {
    return null;
  }
  const dobExact = qualification.qualifiers.includes('dob_exact');
  const weakAlias = weak !== undefined && (dobExact || identifier);
  let score = qualified
    ? Math.min(1, Math.max(0, nameScore + qualification.adjustment))
    : nameScore;
  const { minScore } = options.nameMatching;
  let aboveMinimum =
    nameScore > 0 && (minScore === null ? best?.score.exact === true : score >= minScore);
  let aliasType: AliasType = best?.list.written.primary === false ? 'aka' : 'primary_name';
  let listName = best !== null && nameScore > 0 ? best.list.written.full : primaryOf(record);
  if (weakAlias && WEAK_ALIAS_SCORE > score) {
    score = WEAK_ALIAS_SCORE;
    aliasType = 'weak_aka';
    listName = weak.written.full;
  }
  if (identifier) {
    score = Math.max(score, IDENTIFIER_FLOOR);
  }
  aboveMinimum ||= weakAlias || identifier;
  if (score < DISPLAY_FLOOR || (options.keptOnly === true && !aboveMinimum)) {
    return null;
  }
  const shownName = best !== null && nameScore >= DISPLAY_FLOOR;
  const qualifiers: readonly ReportMatchQualifier[] = qualified
    ? qualification.qualifiers
    : weakAlias && dobExact
      ? ['dob_exact']
      : [];
  const types = new Set<ReportMatchType>();
  if (shownName) {
    types.add(best.score.exact ? 'name_exact' : 'name_fuzzy');
  }
  if (qualifiers.includes('dob_exact')) {
    types.add('birthdate_exact');
  }
  if (identifier) {
    types.add('identifier_exact');
  }
  if (weakAlias) {
    types.add('weak_alias');
  }
  const methods = [
    ...(best !== null && nameScore > 0 ? best.score.methods : []),
    ...(identifier ? ['identifier-exact'] : []),
    ...(weakAlias ? ['weak-alias'] : []),
  ].sort();
  return {
    sourceId,
    entryId: record.entry_id,
    entryKey: entryKey(sourceId, record.entry_id),
    score,
    aboveMinimum,
    matchTypes: REPORT_MATCH_TYPES.filter((type) => types.has(type)),
    qualifiers,
    aliasType,
    subjectName:
      best !== null && nameScore > 0 ? best.subject.text : (subject.names[0]?.text ?? null),
    listName,
    nameScore,
    nameLevel: shownName ? (best.score.exact ? 'full' : 'partial') : null,
    methods,
    lossy: nameScore > 0 && best?.score.lossy === true,
  };
}

/** Screens a subject against candidates; matches sorted by score, then entry key. */
export function screenCandidates(
  subject: ScreeningSubject,
  candidates: readonly ScreeningCandidate[],
  options: ScreeningOptions,
): EntryMatch[] {
  const kinds = new Set<WatchlistRecord['kind']>(options.entityKinds ?? ['entity']);
  const matches: EntryMatch[] = [];
  const memos: PairMemos | null = screeningShortcutEnabled('pair-memo') ? new Map() : null;
  for (const { sourceId, record } of candidates) {
    let match: EntryMatch | null = null;
    if (subject.kind === 'person') {
      match =
        record.kind === 'individual'
          ? screenEntry(subject, sourceId, record, options, true, null, memos)
          : null;
    } else if (kinds.has(record.kind)) {
      match = screenEntry(subject, sourceId, record, options, true, null, memos);
    } else if (record.kind === 'vessel' || record.kind === 'aircraft') {
      match = screenEntry(subject, sourceId, record, options, false, CRAFT_IDENTIFIERS, memos);
    }
    if (match !== null) {
      matches.push(match);
    }
  }
  return matches.sort((left, right) =>
    right.score !== left.score
      ? right.score - left.score
      : left.entryKey < right.entryKey
        ? -1
        : left.entryKey > right.entryKey
          ? 1
          : 0,
  );
}
