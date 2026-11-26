import { describe, expect, it } from 'vitest';
import type { WatchlistRecord } from '../record/schema.js';
import { buildPepRecords } from '../pep/build.js';
import { pepImportSource } from '../pep/import.js';
import { loadPepPositionClasses } from '../pep/positions.js';
import { SANDBOX_PEP_MAGIC } from './sandbox.js';
import {
  PEP_SCENARIO_NAMES,
  SANDBOX_PEP_CLASS_QIDS,
  pepImportAnswers,
  PEP_SPARQL_VARIABLES,
  WIKIDATA_ENTITY,
  pepSparqlAnswer,
  pepSparqlScenarios,
  sandboxPepSparqlFacts,
  sparqlResultsText,
  type PepFacts,
} from './sparql.js';

const NOW = new Date(Date.UTC(2026, 9, 27));
const day = (years: number, months = 0): string => {
  const date = new Date(NOW);
  date.setUTCFullYear(date.getUTCFullYear() + years, date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};
const scenarios = pepSparqlScenarios(NOW);
const qids = (facts: PepFacts): string[] => [
  ...facts.people.flatMap((person) => [
    person.qid,
    ...person.statements.flatMap((s) => [
      s.position,
      ...(s.replacedBy === null ? [] : [s.replacedBy]),
    ]),
  ]),
  ...facts.relations.flatMap((relation) => [relation.person, relation.relative]),
];
const person = (facts: PepFacts, qid: string) => {
  const found = facts.people.find((candidate) => candidate.qid === qid);
  if (found === undefined) {
    throw new Error(`no ${qid}`);
  }
  return found;
};
const subjects = (name: (typeof PEP_SCENARIO_NAMES)[number]) =>
  Object.keys(scenarios[name].expected);

describe('pepSparqlScenarios', () => {
  it('states every C80 scenario with fictional items only', () => {
    expect(Object.keys(scenarios).sort()).toEqual([...PEP_SCENARIO_NAMES].sort());
    for (const name of PEP_SCENARIO_NAMES) {
      const { facts, expected, description } = scenarios[name];
      expect(description.length).toBeGreaterThan(10);
      expect(Object.keys(expected).length).toBeGreaterThan(0);
      for (const qid of qids(facts)) {
        expect(qid, name).toMatch(/^Q-test-/);
      }
      for (const statement of facts.people.flatMap((p) => p.statements)) {
        expect(statement.positionClass).toMatch(/^Q-test-class-/);
      }
    }
  });

  it('dates open-ended tenures: current, ended by a successor or a later holder, or too old', () => {
    const current = scenarios.open_ended_current;
    const [holder] = subjects('open_ended_current');
    expect(person(current.facts, holder ?? '').statements[0]).toMatchObject({
      start: day(-5),
      end: null,
      replacedBy: null,
    });
    expect(current.expected[holder ?? '']).toEqual({ kept: true, inOffice: 'yes' });

    const successor = scenarios.open_ended_with_successor;
    const [first] = subjects('open_ended_with_successor');
    const statement = person(successor.facts, first ?? '').statements[0];
    expect(statement?.end).toBeNull();
    const next = person(successor.facts, statement?.replacedBy ?? '');
    expect(next.statements[0]?.position).toBe(statement?.position);
    expect(successor.expected[first ?? '']).toEqual({
      kept: true,
      inOffice: 'no',
      end: next.statements[0]?.start,
    });

    const later = scenarios.open_ended_later_holder;
    const [earlier] = subjects('open_ended_later_holder');
    expect(
      later.facts.people.filter((p) =>
        p.statements.some(
          (s) => s.position === person(later.facts, earlier ?? '').statements[0]?.position,
        ),
      ),
    ).toHaveLength(2);
    expect(later.expected[earlier ?? '']?.inOffice).toBe('no');

    const old = scenarios.open_ended_too_old;
    const [veteran] = subjects('open_ended_too_old');
    expect(person(old.facts, veteran ?? '').statements[0]?.start).toBe(day(-25));
    expect(old.expected[veteran ?? '']).toEqual({ kept: false, inOffice: 'no', end: 'unknown' });
  });

  it('dates the retention cases from now, with heads of state under their own clock', () => {
    const end = (name: (typeof PEP_SCENARIO_NAMES)[number]) =>
      person(scenarios[name].facts, subjects(name)[0] ?? '').statements[0]?.end;
    expect(end('ended_within_retention')).toBe(day(0, -6));
    expect(end('ended_past_retention')).toBe(day(0, -18));
    expect(end('head_ended_within_head_retention')).toBe(day(-4));
    expect(end('head_ended_past_head_retention')).toBe(day(-6));
    const expectedKept = (name: (typeof PEP_SCENARIO_NAMES)[number]) =>
      scenarios[name].expected[subjects(name)[0] ?? '']?.kept;
    expect(expectedKept('ended_within_retention')).toBe(true);
    expect(expectedKept('ended_past_retention')).toBe(false);
    expect(expectedKept('head_ended_within_head_retention')).toBe(true);
    expect(expectedKept('head_ended_past_head_retention')).toBe(false);
    expect(person(scenarios.deceased.facts, subjects('deceased')[0] ?? '').death).not.toBeNull();
    expect(expectedKept('deceased')).toBe(false);
    const classes = pepSparqlScenarios(NOW, { headOfState: 'Q-test-class-head-x' });
    const head = classes.head_ended_past_head_retention;
    expect(
      person(head.facts, Object.keys(head.expected)[0] ?? '').statements[0]?.positionClass,
    ).toBe('Q-test-class-head-x');
  });

  it('states relatives: adults kept with the install flag, minors and undated never, links by holder', () => {
    const relative = (name: (typeof PEP_SCENARIO_NAMES)[number]) => {
      const { facts, expected } = scenarios[name];
      const [qid = ''] = Object.keys(expected).filter((id) =>
        facts.relations.some((r) => r.relative === id),
      );
      return { facts, expectation: expected[qid], person: person(facts, qid) };
    };
    expect(relative('relative_adult').expectation).toEqual({
      kept: true,
      relativeFlagNeeded: true,
    });
    expect(relative('relative_minor').person.birth).toBe(day(-10));
    expect(relative('relative_minor').expectation?.kept).toBe(false);
    expect(relative('relative_without_birth').person.birth).toBeNull();
    expect(relative('relative_without_birth').expectation?.kept).toBe(false);
    const two = relative('relative_of_two_holders');
    expect(two.facts.relations.filter((r) => r.relative === two.person.qid)).toHaveLength(2);
    expect(two.expectation?.kept).toBe(true);
    expect(relative('relative_of_holder_past_retention').expectation?.kept).toBe(false);
  });
});

describe('pepSparqlAnswer', () => {
  const facts = scenarios.relative_of_two_holders.facts;
  const answer = pepSparqlAnswer(facts);

  it('binds one row per statement, other-language label and relation, with typed terms', () => {
    const statements = facts.people.flatMap((p) => p.statements).length;
    const labels = facts.people.flatMap((p) => p.labels).length;
    expect(answer.results.bindings).toHaveLength(statements + labels + facts.relations.length);
    expect(answer.head.vars).toEqual(expect.arrayContaining(Object.values(PEP_SPARQL_VARIABLES)));
    const row = answer.results.bindings.find((binding) => binding.position !== undefined);
    expect(row?.person?.type).toBe('uri');
    expect(row?.person?.value.startsWith(`${WIKIDATA_ENTITY}Q-test-`)).toBe(true);
    expect(row?.personLabel).toMatchObject({ type: 'literal', 'xml:lang': 'en' });
    expect(row?.start).toMatchObject({
      type: 'literal',
      datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
    });
    expect(row?.start?.value).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
    const relation = answer.results.bindings.find((binding) => binding.relation !== undefined);
    expect(relation?.relation?.value).toMatch(
      /^http:\/\/www\.wikidata\.org\/prop\/direct\/P(?:26|40|22|25|3373)$/,
    );
    expect([
      'http://www.wikidata.org/entity/Q6581072',
      'http://www.wikidata.org/entity/Q6581097',
    ]).toContain(row?.gender?.value);
  });

  it('renames variables and writes its text with a final newline', () => {
    const renamed = pepSparqlAnswer(facts, { person: 'item', positionClass: 'positionType' });
    expect(renamed.head.vars).toContain('item');
    expect(renamed.head.vars).not.toContain('person');
    expect(renamed.results.bindings.some((binding) => binding.positionType !== undefined)).toBe(
      true,
    );
    const text = sparqlResultsText(answer);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(answer);
  });
});

describe('sandboxPepSparqlFacts', () => {
  it('states the sandbox PEP holders in office and the spouse, as Wikidata would', () => {
    const facts = sandboxPepSparqlFacts();
    const ids = facts.people.map((p) => p.qid);
    expect(ids).toContain(SANDBOX_PEP_MAGIC.headOfGovernment.entryId);
    expect(ids).toContain(SANDBOX_PEP_MAGIC.spouse.entryId);
    expect(ids).not.toContain(SANDBOX_PEP_MAGIC.formerMinister.entryId);
    expect(facts.relations).toEqual([
      {
        person: SANDBOX_PEP_MAGIC.headOfGovernment.entryId,
        relative: SANDBOX_PEP_MAGIC.spouse.entryId,
        relation: 'spouse',
      },
    ]);
    for (const statement of facts.people.flatMap((p) => p.statements)) {
      expect(statement.end).toBeNull();
    }
  });
});

describe('pepImportAnswers (C76.2, C80.2, C89.2)', () => {
  async function imported(includeRelatives: boolean): Promise<WatchlistRecord[]> {
    const text = JSON.stringify(pepImportAnswers(sandboxPepSparqlFacts(SANDBOX_PEP_CLASS_QIDS)));
    const records: WatchlistRecord[] = [];
    const builder = buildPepRecords(pepImportSource(text, { maxBytes: 1_000_000 }), {
      now: NOW,
      includeRelatives,
    });
    for (;;) {
      const step = await builder.next();
      if (step.done === true) {
        return records;
      }
      records.push(step.value);
    }
  }

  it('names a pep-positions.json class row of each public class', () => {
    const classes = new Map(loadPepPositionClasses().map((row) => [row.qid, row.pep_class]));
    for (const [pepClass, qid] of Object.entries(SANDBOX_PEP_CLASS_QIDS)) {
      expect(classes.get(qid), qid).toBe(Number(pepClass));
    }
  });

  it('is read by the PEP importer into the sandbox holders, in office with their public classes', async () => {
    const records = await imported(false);
    const P = SANDBOX_PEP_MAGIC;

    expect(records.map((record) => record.entry_id)).toEqual(
      [
        P.headOfGovernment,
        P.ambassador,
        P.internationalOrganisationHead,
        P.stateEnterpriseBoardMember,
        P.mayor,
      ]
        .map((person) => person.entryId)
        .sort(),
    );
    const head = records.find((record) => record.entry_id === P.headOfGovernment.entryId);
    expect(head?.names.map((name) => name.full)).toEqual(['Marlowe Testerton']);
    expect(head?.birth_dates.map((date) => date.value)).toEqual([P.headOfGovernment.birthdate]);
    expect(head?.positions).toEqual([
      expect.objectContaining({
        pep_class: 1,
        in_office: 'yes',
        country: 'GB',
        start: '2023-05-01',
      }),
    ]);
    expect(
      records.map((record) => record.positions.map((position) => position.pep_class)).flat(),
    ).toEqual([1, 2, 2, 3, 4]);
  });

  it('syncs the spouse, linked to the holder, only when relatives are included', async () => {
    const records = await imported(true);
    const spouse = records.find((record) => record.entry_id === SANDBOX_PEP_MAGIC.spouse.entryId);

    expect(spouse?.positions).toEqual([]);
    expect(spouse?.relations).toEqual([
      { relation: 'spouse', entity_id: SANDBOX_PEP_MAGIC.headOfGovernment.entryId },
    ]);
  });
});
