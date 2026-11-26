/**
 * C80.1-C80.4: builds the `wikidata-pep` records from the Wikidata Query Service, one query in
 * flight at a time, through a runner the sync injects (`api-watchlists`' client: POST, the
 * operator's User-Agent, back-off on 429, 75 s a query, its own byte cap). In three passes:
 *
 * 1. **Positions.** Each class row's statements, page by page; each position classified by the
 *    rows that reached it; each statement's tenure decided and kept or dropped by retention. A
 *    holder is kept while one tenure is; only kept tenures reach the record (C80.2, C80.4).
 * 2. **Relatives**, only with `includeRelatives` (the install's
 *    `OPENVERIFY_PEP_INCLUDE_RELATIVES`): the family links of the kept holders of class 1 or 2.
 *    A relative is synced only while a PEP it is linked to is kept, and only when at least 18 on
 *    every reading of a stated birth date (C80.3, V13).
 * 3. **Persons.** Names, birth dates, death, sex and citizenship of every kept holder and relative,
 *    by batch. The deceased are excluded; a person without a name cannot be screened and is left
 *    out, counted.
 *
 * Records come out in QID order and pass `watchlistRecordSchema`. A relative's record carries no
 * positions of its own: `relative_of_class` holds the class of the PEP it relates to, the most
 * senior when several, derived from the kept holders on each pass (owner decision 9 after
 * Workflow 6B), so the class filter reads it from the relative and a holder's reclassification
 * reaches its relatives as a change of risk data; `relations[].entity_id` names the PEPs. The record
 * keeps every distinct label and alias up to its cap (labels first, the English one primary); an
 * alias of one word is weak, as it is no full name.
 */
import { WatchlistParseError } from '../parsers/errors.js';
import type { WatchlistPublication } from '../parsers/list.js';
import {
  birthDate,
  cleanText,
  finishRecord,
  recordName,
  truncateText,
} from '../parsers/normalise.js';
import {
  WATCHLIST_RECORD_LIMITS,
  type RELATION_KINDS,
  type WatchlistRecord,
} from '../record/index.js';
import { wikidataAnswerSource, type PepAnswerSource, type SparqlRunner } from './import.js';
import { classifyPosition, loadPepPositionClasses, type PepPositionClass } from './positions.js';
import {
  PEP_RULE_DEFAULTS,
  relativeMayBeSynced,
  tenureOf,
  tenureRetained,
  type PepRuleOptions,
  type TenureStatement,
} from './rules.js';
import {
  PEP_QUERY_LIMITS,
  personFactRows,
  positionStatementRows,
  relativeRows,
  type PersonFactRow,
  type PositionStatementRow,
} from './sparql.js';

export interface PepBuildOptions extends PepRuleOptions {
  /** `OPENVERIFY_PEP_INCLUDE_RELATIVES`: false syncs no relative and sends no relatives query. */
  readonly includeRelatives: boolean;
  readonly relativeMinimumAgeYears?: number;
  /** The committed table unless given (tests pass fictional rows). */
  readonly classes?: readonly PepPositionClass[];
  readonly pageSize?: number;
  readonly batchSize?: number;
  readonly maxPagesPerClass?: number;
  readonly maxAnswerBytes?: number;
}

/** Counts only: no name, QID or date (C76.5). */
export interface PepBuildStats {
  /** Distinct statements the positions pass read. */
  readonly statements: number;
  /** Records of holders (relatives who also hold a position included). */
  readonly holders: number;
  /** Records of relatives who hold no position. */
  readonly relatives: number;
  /** Holders none of whose tenures is kept. */
  readonly excludedByRetention: number;
  readonly excludedDeceased: number;
  readonly excludedWithoutName: number;
  /** Relatives without a stated birth date or possibly under 18. */
  readonly relativesExcludedByAge: number;
}

/** A PEP build's publication: the sync's time, the records yielded, and the counts. */
export interface PepPublication extends WatchlistPublication {
  readonly stats: PepBuildStats;
}

type RecordPosition = WatchlistRecord['positions'][number];
type RecordName = WatchlistRecord['names'][number];
type Relation = (typeof RELATION_KINDS)[number];

interface HeldStatement extends TenureStatement {
  readonly position: string;
  successor: string | null;
}

interface PositionFacts {
  readonly reachedBy: Set<string>;
  label: string | null;
  readonly jurisdictions: Set<string>;
  readonly countries: Set<string>;
}

interface PersonFacts {
  readonly labels: { readonly text: string; readonly lang: string }[];
  readonly aliases: { readonly text: string; readonly lang: string }[];
  readonly births: string[];
  deceased: boolean;
  sex: 'female' | 'male' | null;
  readonly citizenships: Set<string>;
}

function chunks<Item>(items: readonly Item[], size: number): Item[][] {
  const out: Item[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function only(values: ReadonlySet<string>): string | null {
  return values.size === 1 ? ([...values][0] ?? null) : null;
}

/** The earliest end that may still keep a holder, a month early: older ends need not be fetched. */
function oldestKeptEnd(options: PepBuildOptions): string {
  const months =
    Math.max(
      options.retentionMonths ?? PEP_RULE_DEFAULTS.retentionMonths.value,
      options.headRetentionMonths ?? PEP_RULE_DEFAULTS.headRetentionMonths.value,
    ) + 1;
  const date = new Date(options.now.getTime());
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Labels first, the English (else multilingual, else first) one primary; one-word aliases weak. */
function pepNames(person: PersonFacts): RecordName[] {
  const usable = (entry: { readonly text: string; readonly lang: string }) => {
    const text = cleanText(entry.text);
    return text === null || text.length > WATCHLIST_RECORD_LIMITS.name ? [] : [{ ...entry, text }];
  };
  const byLanguage = (
    left: { readonly text: string; readonly lang: string },
    right: { readonly text: string; readonly lang: string },
  ) => compareText(left.lang, right.lang) || compareText(left.text, right.text);
  const labels = person.labels.flatMap(usable).sort(byLanguage);
  const aliases = person.aliases
    .flatMap(usable)
    .sort(
      (left, right) => compareText(left.text, right.text) || compareText(left.lang, right.lang),
    );
  const primary =
    labels.find((label) => label.lang === 'en') ??
    labels.find((label) => label.lang === 'mul') ??
    labels[0];
  const seen = new Set<string>();
  const names: RecordName[] = [];
  const ordered = [
    ...(primary === undefined ? [] : [{ ...primary, alias: false }]),
    ...labels.map((label) => ({ ...label, alias: false })),
    ...aliases.map((alias) => ({ ...alias, alias: true })),
  ];
  for (const entry of ordered) {
    if (seen.has(entry.text) || names.length >= WATCHLIST_RECORD_LIMITS.names) {
      continue;
    }
    seen.add(entry.text);
    const name = recordName(entry.text, {
      primary: names.length === 0 && primary !== undefined,
      quality: entry.alias && !entry.text.includes(' ') ? 'weak' : 'strong',
    });
    if (name !== null) {
      names.push(name);
    }
  }
  return names;
}

function personFacts(rows: readonly PersonFactRow[]): Map<string, PersonFacts> {
  const facts = new Map<string, PersonFacts>();
  for (const row of rows) {
    let person = facts.get(row.person);
    if (person === undefined) {
      person = {
        labels: [],
        aliases: [],
        births: [],
        deceased: false,
        sex: null,
        citizenships: new Set(),
      };
      facts.set(row.person, person);
    }
    switch (row.fact) {
      case 'label':
        person.labels.push({ text: row.text, lang: row.lang ?? '' });
        break;
      case 'alias':
        person.aliases.push({ text: row.text, lang: row.lang ?? '' });
        break;
      case 'birth':
        if (row.date !== null) {
          person.births.push(row.date);
        }
        break;
      case 'death':
        person.deceased = true;
        break;
      case 'sex':
        person.sex ??= row.sex;
        break;
      case 'citizenship':
        if (row.country !== null) {
          person.citizenships.add(row.country);
        }
        break;
    }
  }
  return facts;
}

/**
 * Builds the PEP records.
 * @throws {WatchlistParseError} for an answer the readers refuse, or `too_large` for a class
 * needing more pages than `maxPagesPerClass`.
 */
export async function* buildPepRecords(
  run: SparqlRunner | PepAnswerSource,
  options: PepBuildOptions,
): AsyncGenerator<WatchlistRecord, PepPublication, undefined> {
  const classes = options.classes ?? loadPepPositionClasses();
  const pageSize = options.pageSize ?? PEP_QUERY_LIMITS.pageSize;
  const batchSize = options.batchSize ?? PEP_QUERY_LIMITS.batchSize;
  const maxPages = options.maxPagesPerClass ?? PEP_QUERY_LIMITS.maxPagesPerClass;
  const source =
    typeof run === 'function'
      ? wikidataAnswerSource(
          run,
          options.maxAnswerBytes === undefined ? {} : { maxAnswerBytes: options.maxAnswerBytes },
        )
      : run;

  // 1. Positions: every statement a class row reaches, merged by statement.
  const statements = new Map<string, HeldStatement>();
  const positions = new Map<string, PositionFacts>();
  const add = (found: PositionStatementRow, rowQid: string) => {
    let position = positions.get(found.position);
    if (position === undefined) {
      position = {
        reachedBy: new Set(),
        label: null,
        jurisdictions: new Set(),
        countries: new Set(),
      };
      positions.set(found.position, position);
    }
    position.reachedBy.add(rowQid);
    position.label ??= found.positionLabel;
    if (found.jurisdiction !== null) {
      position.jurisdictions.add(found.jurisdiction);
    }
    if (found.country !== null) {
      position.countries.add(found.country);
    }
    const known = statements.get(found.statement);
    if (known === undefined) {
      statements.set(found.statement, {
        person: found.person,
        position: found.position,
        start: found.start,
        end: found.end,
        endStated: found.endStated,
        successor: found.successor,
      });
    } else if (known.successor === null || known.successor === 'unknown') {
      // A statement repeated across rows (several successors): a known successor wins.
      known.successor = found.successor ?? known.successor;
    }
  };
  const endedAfter = oldestKeptEnd(options);
  for (const row of classes) {
    for (let page = 0; ; page += 1) {
      if (page >= maxPages) {
        throw new WatchlistParseError(
          'too_large',
          `a position class needs more than ${String(maxPages)} pages`,
        );
      }
      const bindings = await source.positions(row, {
        limit: pageSize,
        offset: page * pageSize,
        endedAfter: row.single_holder ? null : endedAfter,
      });
      for (const found of positionStatementRows(bindings)) {
        add(found, row.qid);
      }
      if (bindings.length < pageSize) {
        break;
      }
    }
  }

  // 2. Tenures: kept while current, incoming or within retention.
  const byPosition = new Map<string, HeldStatement[]>();
  for (const statement of statements.values()) {
    const held = byPosition.get(statement.position) ?? [];
    held.push(statement);
    byPosition.set(statement.position, held);
  }
  const holders = new Map<string, RecordPosition[]>();
  const seen = new Set<string>();
  for (const [qid, held] of byPosition) {
    const facts = positions.get(qid);
    const classing = facts === undefined ? null : classifyPosition(qid, facts.reachedBy, classes);
    if (facts === undefined || classing === null) {
      continue;
    }
    const head = classing.headOfStateOrGovernment && facts.jurisdictions.size > 0;
    const country = only(facts.jurisdictions) ?? only(facts.countries);
    const label = truncateText(facts.label ?? qid, WATCHLIST_RECORD_LIMITS.label);
    for (const statement of held) {
      seen.add(statement.person);
      const tenure = tenureOf(statement, held, classing.singleHolder, options);
      if (!tenureRetained(tenure, head, options)) {
        continue;
      }
      const kept = holders.get(statement.person) ?? [];
      kept.push({
        position: qid,
        label,
        pep_class: classing.pepClass,
        country,
        start: tenure.start,
        end: tenure.end,
        in_office: tenure.in_office,
      });
      holders.set(statement.person, kept);
    }
  }

  // 3. Relatives of the kept holders of class 1 or 2, only with the install flag.
  const links = new Map<string, Map<string, Relation>>();
  if (options.includeRelatives) {
    const eligible = [...holders]
      .filter(([, held]) => held.some((position) => (position.pep_class ?? 5) <= 2))
      .map(([qid]) => qid)
      .sort();
    for (const chunk of chunks(eligible, batchSize)) {
      const asked = new Set(chunk);
      for (const link of relativeRows(await source.relatives(chunk))) {
        // Only a link of a PEP this query named, never of another person the answer brings.
        if (!asked.has(link.person) || link.relative === link.person) {
          continue;
        }
        const linked = links.get(link.relative) ?? new Map<string, Relation>();
        if (!linked.has(link.person)) {
          linked.set(link.person, link.relation);
        }
        links.set(link.relative, linked);
      }
    }
  }

  // A kept holder's class: the most senior of its kept positions' classes.
  const holderClass = (qid: string): number | null =>
    (holders.get(qid) ?? []).reduce<number | null>(
      (best, position) =>
        position.pep_class !== null && (best === null || position.pep_class < best)
          ? position.pep_class
          : best,
      null,
    );

  // 4. Persons: one record each, in QID order.
  let holderRecords = 0;
  let relativeRecords = 0;
  let excludedDeceased = 0;
  let excludedWithoutName = 0;
  let relativesExcludedByAge = 0;
  const subjects = [...new Set([...holders.keys(), ...links.keys()])].sort();
  for (const chunk of chunks(subjects, batchSize)) {
    const facts = personFacts(personFactRows(await source.persons(chunk)));
    for (const qid of chunk) {
      const person = facts.get(qid);
      if (person?.deceased === true) {
        excludedDeceased += 1;
        continue;
      }
      const held = holders.get(qid) ?? [];
      const linked = links.get(qid);
      let relations: { relation: Relation; entity_id: string }[] = [];
      if (linked !== undefined) {
        const allowed = relativeMayBeSynced(person?.births ?? [], {
          now: options.now,
          ...(options.relativeMinimumAgeYears === undefined
            ? {}
            : { minimumAgeYears: options.relativeMinimumAgeYears }),
        });
        if (allowed) {
          relations = [...linked]
            .map(([pep, relation]) => ({ relation, entity_id: pep }))
            .sort((left, right) => compareText(left.entity_id, right.entity_id));
        } else {
          relativesExcludedByAge += 1;
        }
      }
      if (held.length === 0 && relations.length === 0) {
        continue;
      }
      // Owner decision 9 after 6B: the most senior class of the PEPs it relates to.
      const relativeOfClass = relations.reduce<number | null>((best, { entity_id }) => {
        const linked = holderClass(entity_id);
        return linked !== null && (best === null || linked < best) ? linked : best;
      }, null);
      const names = person === undefined ? [] : pepNames(person);
      if (person === undefined || names.length === 0) {
        excludedWithoutName += 1;
        continue;
      }
      const record = finishRecord(
        {
          entry_id: qid,
          kind: 'individual',
          names,
          birth_dates: person.births.flatMap((value) => birthDate(value) ?? []),
          countries: [...person.citizenships].sort().map((code) => ({ code, role: 'citizenship' })),
          ...(person.sex === null ? {} : { gender: person.sex }),
          positions: [...held].sort(
            (left, right) =>
              compareText(left.position, right.position) ||
              compareText(left.start ?? '', right.start ?? ''),
          ),
          relations,
          ...(relativeOfClass === null ? {} : { relative_of_class: relativeOfClass }),
        },
        holderRecords + relativeRecords + 1,
      );
      if (held.length > 0) {
        holderRecords += 1;
      } else {
        relativeRecords += 1;
      }
      yield record;
    }
  }
  return {
    publishedAt: options.now.toISOString(),
    entries: holderRecords + relativeRecords,
    stats: {
      statements: statements.size,
      holders: holderRecords,
      relatives: relativeRecords,
      excludedByRetention: seen.size - holders.size,
      excludedDeceased,
      excludedWithoutName,
      relativesExcludedByAge,
    },
  };
}
