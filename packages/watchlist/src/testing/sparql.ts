/**
 * Synthetic Wikidata Query Service answers (C80.1-C80.4) in the SPARQL 1.1 JSON results format,
 * with fictional `Q-test-…` items only: holders and their position statements, successors,
 * relatives, deaths, and the scenarios each PEP rule needs (open-ended tenures, retention,
 * relatives' age and links). Dates are relative to a `now` the caller fixes, so a scenario keeps
 * its meaning on any day. Public Wikidata identifiers appear only as such: the gender items and the
 * family-relation properties (P26 spouse, P40 child, P22 father, P25 mother, P3373 sibling).
 *
 * The variable names are ours (`PEP_SPARQL_VARIABLES`): `pep:sync`'s query and the SPARQL result
 * parser must agree on them, so every renderer takes a renaming.
 */
import { PEP_IMPORT_FORMAT } from '../pep/import.js';
import { SANDBOX_PEP_MAGIC, type SandboxPerson } from './sandbox.js';

/** The Wikidata entity URI prefix. */
export const WIKIDATA_ENTITY = 'http://www.wikidata.org/entity/';

/** One cell of a SPARQL JSON binding. */
export interface SparqlTerm {
  readonly type: 'uri' | 'literal';
  readonly value: string;
  readonly datatype?: string;
  readonly 'xml:lang'?: string;
}

/** A SPARQL 1.1 JSON results document. */
export interface SparqlResults {
  readonly head: { readonly vars: readonly string[] };
  readonly results: { readonly bindings: readonly Readonly<Record<string, SparqlTerm>>[] };
}

/** A position statement (P39) of a holder. */
export interface PepFactStatement {
  readonly position: string;
  readonly positionLabel: string;
  /** The position class the sync pages by (a `pep-positions.json` class QID in real data). */
  readonly positionClass: string;
  readonly start: string | null;
  readonly end: string | null;
  /** P1366, the successor's QID. */
  readonly replacedBy: string | null;
}

/** A person item: a holder (with statements) or a relative (without). */
export interface PepFactPerson {
  readonly qid: string;
  readonly label: string;
  /** Labels in other languages and scripts. */
  readonly labels: readonly { readonly text: string; readonly lang: string }[];
  readonly birth: string | null;
  readonly death: string | null;
  readonly gender: 'female' | 'male' | null;
  /** ISO 3166-1 alpha-2 (P27 → P297). */
  readonly citizenship: string | null;
  readonly statements: readonly PepFactStatement[];
}

/** A family link stated on the holder (`person`) to `relative`. */
export interface PepFactRelation {
  readonly person: string;
  readonly relative: string;
  readonly relation: 'spouse' | 'child' | 'parent' | 'sibling';
}

export interface PepFacts {
  readonly people: readonly PepFactPerson[];
  readonly relations: readonly PepFactRelation[];
}

/** The variables the PEP answers bind; rename them to match a query. */
export const PEP_SPARQL_VARIABLES = Object.freeze({
  person: 'person',
  personLabel: 'personLabel',
  alias: 'alias',
  position: 'position',
  positionLabel: 'positionLabel',
  positionClass: 'class',
  start: 'start',
  end: 'end',
  replacedBy: 'replacedBy',
  birth: 'birth',
  death: 'death',
  gender: 'gender',
  citizenship: 'citizenship',
  relative: 'relative',
  relativeLabel: 'relativeLabel',
  relation: 'relation',
  relativeBirth: 'relativeBirth',
  relativeDeath: 'relativeDeath',
});
export type PepSparqlVariables = Record<keyof typeof PEP_SPARQL_VARIABLES, string>;

/** The class QIDs the scenarios use for each kind of position (fictional unless given). */
export interface PepScenarioClasses {
  readonly headOfState: string;
  readonly minister: string;
  readonly ambassador: string;
  readonly mayor: string;
}

/** What the C80.2-C80.4 rules say about one person of a scenario. */
export interface PepExpectation {
  /** Whether the sync keeps the person (retention, death, relatives' rules). */
  readonly kept: boolean;
  /** For a holder: whether the tenure counts as current. */
  readonly inOffice?: 'yes' | 'no';
  /** For an open-ended tenure judged ended: `unknown`, or the date it ended. */
  readonly end?: string;
  /** For a relative: whether it is synced only with `OPENVERIFY_PEP_INCLUDE_RELATIVES=true`. */
  readonly relativeFlagNeeded?: boolean;
}

export interface PepScenario {
  readonly description: string;
  readonly facts: PepFacts;
  /** By QID: what the rules say about the scenario's subjects. */
  readonly expected: Readonly<Record<string, PepExpectation>>;
}

export const PEP_SCENARIO_NAMES = [
  'open_ended_current',
  'open_ended_with_successor',
  'open_ended_later_holder',
  'open_ended_too_old',
  'ended_within_retention',
  'ended_past_retention',
  'head_ended_within_head_retention',
  'head_ended_past_head_retention',
  'deceased',
  'relative_adult',
  'relative_minor',
  'relative_without_birth',
  'relative_of_two_holders',
  'relative_of_holder_past_retention',
] as const;
export type PepScenarioName = (typeof PEP_SCENARIO_NAMES)[number];

const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime';
const GENDER_ITEMS = { female: 'Q6581072', male: 'Q6581097' } as const;
const RELATION_PROPERTIES = { spouse: 'P26', child: 'P40', sibling: 'P3373' } as const;
const DEFAULT_CLASSES: PepScenarioClasses = {
  headOfState: 'Q-test-class-head-of-state',
  minister: 'Q-test-class-minister',
  ambassador: 'Q-test-class-ambassador',
  mayor: 'Q-test-class-mayor',
};

/** `now` moved by whole years and months, as `YYYY-MM-DD`. */
function shifted(now: Date, years: number, months = 0): string {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() + years, date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/** The scenarios of C80.2-C80.4, dated from `now`. */
export function pepSparqlScenarios(
  now: Date,
  classes: Partial<PepScenarioClasses> = {},
): Readonly<Record<PepScenarioName, PepScenario>> {
  const at = (years: number, months = 0): string => shifted(now, years, months);
  const cls = { ...DEFAULT_CLASSES, ...classes };
  const labels: Record<string, string> = {
    [cls.headOfState]: 'Synthetic Head of State',
    [cls.minister]: 'Synthetic Minister of Testing',
    [cls.ambassador]: 'Synthetic Ambassador',
    [cls.mayor]: 'Synthetic Mayor',
  };
  const statement = (
    position: number,
    positionClass: string,
    start: string | null,
    end: string | null,
    replacedBy: string | null = null,
  ): PepFactStatement => ({
    position: `Q-test-${String(position)}`,
    positionLabel: labels[positionClass] ?? 'Synthetic Position',
    positionClass,
    start,
    end,
    replacedBy,
  });
  const someone = (
    qid: number,
    statements: readonly PepFactStatement[],
    overrides: Partial<PepFactPerson> = {},
  ): PepFactPerson => ({
    qid: `Q-test-${String(qid)}`,
    label: `Synthetic Person ${String(qid)}`,
    labels: [],
    birth: at(-55),
    death: null,
    gender: qid % 2 === 0 ? 'female' : 'male',
    citizenship: 'GB',
    statements,
    ...overrides,
  });
  const relation = (
    person: number,
    relative: number,
    kind: PepFactRelation['relation'],
  ): PepFactRelation => ({
    person: `Q-test-${String(person)}`,
    relative: `Q-test-${String(relative)}`,
    relation: kind,
  });
  const scenario = (
    description: string,
    people: readonly PepFactPerson[],
    expected: Readonly<Record<string, PepExpectation>>,
    relations: readonly PepFactRelation[] = [],
  ): PepScenario => ({ description, facts: { people, relations }, expected });
  const current = (qid: number, position: number) =>
    someone(qid, [statement(position, cls.minister, at(-3), null)]);

  return {
    open_ended_current: scenario(
      'A tenure without an end date, without a successor, started 5 years ago: current.',
      [
        someone(3001, [statement(3901, cls.minister, at(-5), null)], {
          labels: [{ text: 'Синтетическая Персона 3001', lang: 'ru' }],
        }),
      ],
      { 'Q-test-3001': { kept: true, inOffice: 'yes' } },
    ),
    open_ended_with_successor: scenario(
      'A tenure without an end date whose statement names a successor (P1366), who took the same position 6 months ago: ended at the successor’s start.',
      [
        someone(3011, [statement(3911, cls.minister, at(-6), null, 'Q-test-3012')]),
        someone(3012, [statement(3911, cls.minister, at(0, -6), null)]),
      ],
      { 'Q-test-3011': { kept: true, inOffice: 'no', end: at(0, -6) } },
    ),
    open_ended_later_holder: scenario(
      'Two open-ended tenures of one single-holder position (a head of state); the later holder started 3 months ago, so the earlier tenure is not current.',
      [
        someone(3021, [statement(3921, cls.headOfState, at(-8), null)]),
        someone(3022, [statement(3921, cls.headOfState, at(0, -3), null)]),
      ],
      { 'Q-test-3021': { kept: true, inOffice: 'no' } },
    ),
    open_ended_too_old: scenario(
      'A tenure without an end date started 25 years ago (beyond the 20-year limit): ended at an unknown date, which counts as older than the retention.',
      [someone(3031, [statement(3931, cls.minister, at(-25), null)])],
      { 'Q-test-3031': { kept: false, inOffice: 'no', end: 'unknown' } },
    ),
    ended_within_retention: scenario(
      'A tenure that ended 6 months ago: kept (12-month retention).',
      [someone(3041, [statement(3941, cls.minister, at(-4), at(0, -6))])],
      { 'Q-test-3041': { kept: true, inOffice: 'no' } },
    ),
    ended_past_retention: scenario(
      'A tenure that ended 18 months ago: excluded (12-month retention).',
      [someone(3051, [statement(3951, cls.minister, at(-5), at(0, -18))])],
      { 'Q-test-3051': { kept: false, inOffice: 'no' } },
    ),
    head_ended_within_head_retention: scenario(
      'A head of state who left office 4 years ago: kept (5-year retention for heads of state or government).',
      [someone(3061, [statement(3961, cls.headOfState, at(-9), at(-4))])],
      { 'Q-test-3061': { kept: true, inOffice: 'no' } },
    ),
    head_ended_past_head_retention: scenario(
      'A head of state who left office 6 years ago: excluded.',
      [someone(3071, [statement(3971, cls.headOfState, at(-11), at(-6))])],
      { 'Q-test-3071': { kept: false, inOffice: 'no' } },
    ),
    deceased: scenario(
      'A holder in office who died 2 months ago: excluded.',
      [someone(3081, [statement(3981, cls.minister, at(-3), null)], { death: at(0, -2) })],
      { 'Q-test-3081': { kept: false } },
    ),
    relative_adult: scenario(
      'The spouse, born 40 years ago, of a minister in office: synced only with the install flag.',
      [current(3091, 3991), someone(3092, [], { birth: at(-40) })],
      { 'Q-test-3092': { kept: true, relativeFlagNeeded: true } },
      [relation(3091, 3092, 'spouse')],
    ),
    relative_minor: scenario(
      'A child, born 10 years ago, of a minister in office: never synced.',
      [current(3101, 4001), someone(3102, [], { birth: at(-10) })],
      { 'Q-test-3102': { kept: false } },
      [relation(3101, 3102, 'child')],
    ),
    relative_without_birth: scenario(
      'A sibling with no birth date of a minister in office: never synced.',
      [current(3111, 4011), someone(3112, [], { birth: null })],
      { 'Q-test-3112': { kept: false } },
      [relation(3111, 3112, 'sibling')],
    ),
    relative_of_two_holders: scenario(
      'A relative linked to a minister in office and to a holder past retention: kept while either holder is.',
      [
        current(3121, 4021),
        someone(3122, [statement(4022, cls.ambassador, at(-8), at(-3))], { birth: at(-80) }),
        someone(3123, [], { birth: at(-35) }),
      ],
      {
        'Q-test-3123': { kept: true, relativeFlagNeeded: true },
        'Q-test-3122': { kept: false, inOffice: 'no' },
      },
      [relation(3121, 3123, 'sibling'), relation(3122, 3123, 'child')],
    ),
    relative_of_holder_past_retention: scenario(
      'The spouse of a holder whose last position ended 3 years ago: excluded with that holder.',
      [
        someone(3131, [statement(4031, cls.mayor, at(-9), at(-3))]),
        someone(3132, [], { birth: at(-60) }),
      ],
      { 'Q-test-3132': { kept: false }, 'Q-test-3131': { kept: false, inOffice: 'no' } },
      [relation(3131, 3132, 'spouse')],
    ),
  };
}

const uri = (id: string): SparqlTerm => ({ type: 'uri', value: `${WIKIDATA_ENTITY}${id}` });
const text = (value: string, lang?: string): SparqlTerm =>
  lang === undefined ? { type: 'literal', value } : { type: 'literal', value, 'xml:lang': lang };
const dateTime = (value: string | null): SparqlTerm | undefined =>
  value === null
    ? undefined
    : { type: 'literal', datatype: XSD_DATE_TIME, value: `${value}T00:00:00Z` };

/** A binding without its absent cells. */
const binding = (
  cells: Record<string, SparqlTerm | undefined>,
): Readonly<Record<string, SparqlTerm>> =>
  Object.fromEntries(
    Object.entries(cells).filter((cell): cell is [string, SparqlTerm] => cell[1] !== undefined),
  );

function relationProperty(relation: PepFactRelation, relative: PepFactPerson | undefined): string {
  if (relation.relation === 'parent') {
    return relative?.gender === 'male' ? 'P22' : 'P25';
  }
  return RELATION_PROPERTIES[relation.relation];
}

/** The SPARQL answer stating `facts`: a row per statement, alias and relation. */
export function pepSparqlAnswer(
  facts: PepFacts,
  variables: Partial<PepSparqlVariables> = {},
): SparqlResults {
  const v: PepSparqlVariables = { ...PEP_SPARQL_VARIABLES, ...variables };
  const byId = new Map(facts.people.map((person) => [person.qid, person] as const));
  const rows = [
    ...facts.people.flatMap((person) => [
      ...person.statements.map((statement) =>
        binding({
          [v.person]: uri(person.qid),
          [v.personLabel]: text(person.label, 'en'),
          [v.position]: uri(statement.position),
          [v.positionLabel]: text(statement.positionLabel, 'en'),
          [v.positionClass]: uri(statement.positionClass),
          [v.start]: dateTime(statement.start),
          [v.end]: dateTime(statement.end),
          [v.replacedBy]: statement.replacedBy === null ? undefined : uri(statement.replacedBy),
          [v.birth]: dateTime(person.birth),
          [v.death]: dateTime(person.death),
          [v.gender]: person.gender === null ? undefined : uri(GENDER_ITEMS[person.gender]),
          [v.citizenship]: person.citizenship === null ? undefined : text(person.citizenship),
        }),
      ),
      ...person.labels.map((label) =>
        binding({ [v.person]: uri(person.qid), [v.alias]: text(label.text, label.lang) }),
      ),
    ]),
    ...facts.relations.map((relation) => {
      const relative = byId.get(relation.relative);
      return binding({
        [v.person]: uri(relation.person),
        [v.relative]: uri(relation.relative),
        [v.relativeLabel]: relative === undefined ? undefined : text(relative.label, 'en'),
        [v.relation]: {
          type: 'uri',
          value: `http://www.wikidata.org/prop/direct/${relationProperty(relation, relative)}`,
        },
        [v.relativeBirth]: dateTime(relative?.birth ?? null),
        [v.relativeDeath]: dateTime(relative?.death ?? null),
      });
    }),
  ];
  return { head: { vars: Object.values(v) }, results: { bindings: rows } };
}

/** The answer's text, two-space JSON with a final newline. */
export function sparqlResultsText(results: SparqlResults): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

/**
 * The sandbox PEP magic holders in office and the spouse (C82.4), as Wikidata would state them,
 * for a `wikidata-pep` import in the e2e (C89.2). Their position classes are fictional
 * (`Q-test-class-pep-<n>`): pass the `pep-positions.json` class QIDs a test needs.
 */
export function sandboxPepSparqlFacts(
  classes: Partial<Record<1 | 2 | 3 | 4, string>> = {},
): PepFacts {
  const P = SANDBOX_PEP_MAGIC;
  const classOf = (pepClass: 1 | 2 | 3 | 4): string =>
    classes[pepClass] ?? `Q-test-class-pep-${String(pepClass)}`;
  const holder = (
    person: SandboxPerson,
    position: string,
    positionLabel: string,
    pepClass: 1 | 2 | 3 | 4,
    start: string,
  ): PepFactPerson => ({
    qid: person.entryId,
    label: `${person.givenName} ${person.familyName}`,
    labels: [],
    birth: person.birthdate,
    death: null,
    gender: null,
    citizenship: person.country,
    statements: [
      {
        position,
        positionLabel,
        positionClass: classOf(pepClass),
        start,
        end: null,
        replacedBy: null,
      },
    ],
  });
  return {
    people: [
      holder(P.headOfGovernment, 'Q-test-2001', 'Synthetic Head of Government', 1, '2023-05-01'),
      holder(P.ambassador, 'Q-test-2003', 'Synthetic Ambassador', 2, '2022-09-01'),
      holder(
        P.internationalOrganisationHead,
        'Q-test-2004',
        'Synthetic Secretary-General of an International Organisation',
        2,
        '2024-01-15',
      ),
      holder(
        P.stateEnterpriseBoardMember,
        'Q-test-2005',
        'Synthetic State Enterprise Board Member',
        3,
        '2021-06-01',
      ),
      holder(P.mayor, 'Q-test-2006', 'Synthetic Mayor', 4, '2024-07-01'),
      {
        qid: P.spouse.entryId,
        label: `${P.spouse.givenName} ${P.spouse.familyName}`,
        labels: [],
        birth: P.spouse.birthdate,
        death: null,
        gender: 'female',
        citizenship: P.spouse.country,
        statements: [],
      },
    ],
    relations: [
      { person: P.headOfGovernment.entryId, relative: P.spouse.entryId, relation: 'spouse' },
    ],
  };
}

/**
 * C80.2, C89.2: a real `pep-positions.json` class QID per public PEP class, for a synthetic import
 * that the build classifies as Wikidata data would be (head of government, ambassador,
 * state-owned enterprise, mayor). Public Wikidata identifiers of position classes only.
 */
export const SANDBOX_PEP_CLASS_QIDS: Readonly<Record<1 | 2 | 3 | 4, string>> = Object.freeze({
  1: 'Q2285706',
  2: 'Q121998',
  3: 'Q270791',
  4: 'Q30185',
});

/** The `openverify/wikidata-pep-answers/v1` document `pep:sync --import` reads (C76.2). */
export interface PepImportAnswers {
  readonly format: typeof PEP_IMPORT_FORMAT;
  readonly positions: Readonly<Record<string, SparqlResults>>;
  readonly persons: SparqlResults;
  readonly relatives: SparqlResults;
}

const INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
/** Wikidata's day precision (11), as the query service states it beside a time value. */
const DAY_PRECISION: SparqlTerm = { type: 'literal', datatype: INTEGER, value: '11' };
const results = (bindings: readonly Readonly<Record<string, SparqlTerm>>[]): SparqlResults => ({
  head: { vars: [] },
  results: { bindings },
});

/**
 * The import document stating `facts` (C76.2, C89.2): per position class, the rows the positions
 * query answers; the persons query's fact rows (labels, aliases, birth, death, sex, citizenship);
 * and the relatives query's rows. The variables are the live queries' (`pep/sparql.ts`), so the
 * importer reads it with the readers of live answers. A statement's jurisdiction and country are
 * the holder's citizenship.
 */
export function pepImportAnswers(facts: PepFacts): PepImportAnswers {
  const positions: Record<string, Readonly<Record<string, SparqlTerm>>[]> = {};
  let statementNumber = 0;
  for (const person of facts.people) {
    for (const statement of person.statements) {
      statementNumber += 1;
      const rows = (positions[statement.positionClass] ??= []);
      rows.push(
        binding({
          statement: uri(`statement/synthetic-${String(statementNumber)}`),
          person: uri(person.qid),
          position: uri(statement.position),
          positionLabel: text(statement.positionLabel, 'en'),
          start: dateTime(statement.start),
          startPrecision: statement.start === null ? undefined : DAY_PRECISION,
          end: dateTime(statement.end),
          endPrecision: statement.end === null ? undefined : DAY_PRECISION,
          successor: statement.replacedBy === null ? undefined : uri(statement.replacedBy),
          jurisdiction: person.citizenship === null ? undefined : text(person.citizenship),
          country: person.citizenship === null ? undefined : text(person.citizenship),
        }),
      );
    }
  }
  const fact = (
    person: PepFactPerson,
    name: string,
    cells: Record<string, SparqlTerm | undefined>,
  ) => binding({ person: uri(person.qid), fact: text(name), ...cells });
  const persons = facts.people.flatMap((person) => [
    fact(person, 'label', { value: text(person.label, 'en') }),
    ...person.labels.map((label) => fact(person, 'alias', { value: text(label.text, label.lang) })),
    ...(person.birth === null
      ? []
      : [fact(person, 'birth', { value: dateTime(person.birth), precision: DAY_PRECISION })]),
    ...(person.death === null
      ? []
      : [fact(person, 'death', { value: dateTime(person.death), precision: DAY_PRECISION })]),
    ...(person.gender === null
      ? []
      : [fact(person, 'sex', { value: uri(GENDER_ITEMS[person.gender]) })]),
    ...(person.citizenship === null
      ? []
      : [fact(person, 'citizenship', { value: text(person.citizenship) })]),
  ]);
  const relatives = facts.relations.map((relation) =>
    binding({
      person: uri(relation.person),
      relation: text(relation.relation),
      relative: uri(relation.relative),
    }),
  );
  return {
    format: PEP_IMPORT_FORMAT,
    positions: Object.fromEntries(
      Object.entries(positions).map(([qid, rows]) => [qid, results(rows)]),
    ),
    persons: results(persons),
    relatives: results(relatives),
  };
}
