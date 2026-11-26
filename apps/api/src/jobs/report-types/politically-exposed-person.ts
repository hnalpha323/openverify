/**
 * C80.5 (Workflow 6A Stage 3, owner `api-reports`): the `politically-exposed-person` report job,
 * behind the frozen `ReportTypeJob` of `jobs/report-types/index.ts`. A person screened against the
 * pinned PEP sources (`wikidata-pep`; the sandbox PEP list in sandbox), with the template's
 * `pep-classes`: a holder is screened when one of its positions is of a selected class (or of no
 * known class, with `include-unknown-class`); a relative only with `include-relatives`, when a
 * holder it is linked to qualifies. H-tier and `beta`: Wikidata's coverage is uneven, so a miss is
 * not evidence of non-PEP status (`pep_coverage_uneven`).
 */
import type { BirthdateMatchingMode, ReportFilterMode } from '@openverify/core';
import { personSubject, type WatchlistRecord } from '@openverify/watchlist';
import {
  birthdatesOf,
  countriesOf,
  screenNames,
  type LinkedRecords,
  type NameScreening,
} from '../reports/screening.js';
import type { ReportTypeJob } from './job.js';
import { relativeEvidence } from './record-evidence.js';

const QID = /^Q(?:[1-9]\d{0,11}|-test-[a-z0-9-]{1,32})$/;
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fullDate = (value: string | null): string | null =>
  value !== null && FULL_DATE.test(value) ? value : null;
const wikidataPage = (qid: string) => `https://www.wikidata.org/wiki/${qid}`;

/** The holders a relative is linked to. */
function holdersOf(sourceId: string, record: WatchlistRecord, linked: LinkedRecords) {
  return record.relations.flatMap((relation) => {
    const holder = linked(sourceId, relation.entity_id);
    return holder === undefined ? [] : [{ relation, holder }];
  });
}

/** The screening of a `politically-exposed-person` report's query under its configuration. */
export function politicallyExposedPersonScreening(
  query: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>,
): NameScreening {
  const classes = new Set(
    Array.isArray(config['pep-classes']) ? (config['pep-classes'] as number[]) : [1, 2],
  );
  const includeRelatives = config['include-relatives'] === true;
  const includeUnknown = config['include-unknown-class'] === true;
  const qualifies = (record: WatchlistRecord) =>
    record.positions.some((position) =>
      position.pep_class === null ? includeUnknown : classes.has(position.pep_class),
    );
  const defaultCountry =
    typeof config['default-country'] === 'string' ? config['default-country'] : null;
  return {
    type: 'politically-exposed-person',
    subject: () => personSubject(query, { defaultCountry }),
    options: {
      birthdateMatching: config['birthdate-matching'] as BirthdateMatchingMode,
      birthdateFilter: config['birthdate-filter'] as ReportFilterMode,
      countryFields: ['birthplace', 'citizenship', 'nationality', 'residency'],
      countryFilter: 'penalty',
      screenWeakAliases: false,
      keepWithoutBirthdate: config['keep-without-birthdate'] !== false,
    },
    entryKinds: ['individual'],
    admit: ({ sourceId, record }, linked) => {
      if (record.positions.length > 0) {
        return qualifies(record);
      }
      // Owner decision 9 after 6B: a relative's class is its own record's (`relative_of_class`,
      // derived by the PEP build on each pass); a relative stored before it is read through its
      // linked holder.
      return (
        includeRelatives &&
        (record.relative_of_class === undefined
          ? holdersOf(sourceId, record, linked).some(({ holder }) => qualifies(holder))
          : classes.has(record.relative_of_class))
      );
    },
    entity: (match, { sourceId, record }, linked) => {
      const relative = record.positions.length === 0;
      const positions = record.positions.filter((position) => QID.test(position.position));
      const sources: Record<string, string> = {};
      for (const qid of [record.entry_id, ...positions.map((position) => position.position)]) {
        if (QID.test(qid)) {
          sources[qid] = wikidataPage(qid);
        }
      }
      return {
        'entity-id': match.entryKey,
        name: match.listName.slice(0, 300),
        birthdates: birthdatesOf(record),
        'death-dates': [],
        country: countriesOf(record)[0] ?? positions[0]?.country ?? null,
        sex: record.gender ?? null,
        'match-types': [...match.matchTypes],
        'pep-type': relative ? 'relative' : 'pep',
        positions: positions.map((position) => ({
          position: position.label.slice(0, 300),
          'pep-class': position.pep_class,
          country: position.country,
          start: fullDate(position.start),
          end: position.end === 'unknown' ? 'unknown' : fullDate(position.end),
          'in-office': position.in_office,
          'source-key': position.position,
        })),
        associates: relative
          ? holdersOf(sourceId, record, linked).flatMap(({ relation, holder }) => {
              const name =
                holder.names.find((entry) => entry.primary)?.full ?? holder.names[0]?.full;
              return name === undefined
                ? []
                : [{ name: name.slice(0, 300), relationship: relation.relation }];
            })
          : [],
        sources,
        ...(relative ? relativeEvidence(record) : {}),
      };
    },
    notices: ['pep_coverage_uneven'],
    unavailableFields: [],
  };
}

export const politicallyExposedPersonReportJob: ReportTypeJob = {
  type: 'politically-exposed-person',
  run: (ctx) =>
    screenNames(ctx, politicallyExposedPersonScreening(ctx.report.query, ctx.report.config)),
};
