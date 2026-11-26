/**
 * C80.2: the committed PEP position classes and how a position takes its class. The table names
 * Wikidata classes by public QID; the classification cases use fictional `Q-test` positions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyPosition,
  loadPepPositionClasses,
  PEP_DATA_DIRECTORY,
  PEP_POSITIONS_FILE,
  pepPositionsFileSchema,
  type PepPositionClass,
} from './positions.js';

const row = (qid: string, overrides: Partial<PepPositionClass> = {}): PepPositionClass => ({
  qid,
  label: 'synthetic class',
  pep_class: 2,
  selector: 'subclass',
  single_holder: false,
  head_of_state_or_government: false,
  refines: [],
  source: 'authored',
  note: 'Synthetic row for tests.',
  ...overrides,
});

describe('the committed PEP position table', () => {
  const table = () => {
    const classes = loadPepPositionClasses();
    return { classes, byQid: new Map(classes.map((entry) => [entry.qid, entry])) };
  };

  it('parses, names each QID once, and refines only rows it holds', () => {
    const { classes, byQid } = table();
    const file = pepPositionsFileSchema.parse(
      JSON.parse(readFileSync(join(PEP_DATA_DIRECTORY, PEP_POSITIONS_FILE), 'utf8')),
    );
    expect(file.classes).toEqual(classes);
    expect(new Set(classes.map((entry) => entry.qid)).size).toBe(classes.length);
    for (const entry of classes) {
      for (const broader of entry.refines) {
        expect(byQid.has(broader), `${entry.qid} refines ${broader}`).toBe(true);
      }
    }
    expect(loadPepPositionClasses()).toBe(classes);
  });

  it('covers the four public classes', () => {
    const { classes } = table();
    expect(new Set(classes.map((entry) => entry.pep_class))).toEqual(new Set([1, 2, 3, 4]));
  });

  it('puts heads of state and government in class 1 with the head retention', () => {
    const { classes, byQid } = table();
    for (const qid of ['Q48352', 'Q2285706']) {
      expect(byQid.get(qid)).toMatchObject({
        pep_class: 1,
        selector: 'subclass',
        single_holder: true,
        head_of_state_or_government: true,
      });
    }
    expect(classes.filter((entry) => entry.head_of_state_or_government)).toHaveLength(2);
  });

  it('puts the heads of international organisations in class 2 and state enterprises in 3', () => {
    const { byQid } = table();
    expect(byQid.get('Q484652')).toMatchObject({ pep_class: 2, selector: 'directs' });
    expect(byQid.get('Q270791')).toMatchObject({ pep_class: 3, selector: 'directs' });
  });

  it('keeps mayors in class 4 although a mayor heads a municipal government', () => {
    const { classes, byQid } = table();
    expect(byQid.get('Q30185')).toMatchObject({ pep_class: 4, refines: ['Q2285706'] });
    expect(classifyPosition('Q-test-3001', new Set(['Q30185', 'Q2285706']), classes)).toMatchObject(
      { pepClass: 4, headOfStateOrGovernment: false },
    );
  });
});

describe('classifyPosition', () => {
  const head = row('Q-test-1', {
    pep_class: 1,
    single_holder: true,
    head_of_state_or_government: true,
  });
  const minister = row('Q-test-2', { pep_class: 1 });
  const ambassador = row('Q-test-3', { pep_class: 2 });
  const mayor = row('Q-test-4', { pep_class: 4, single_holder: true, refines: ['Q-test-1'] });
  const classes = [head, minister, ambassador, mayor];

  it('takes the lowest class of the rows that decide', () => {
    expect(classifyPosition('Q-test-9', new Set(['Q-test-3']), classes)).toEqual({
      pepClass: 2,
      singleHolder: false,
      headOfStateOrGovernment: false,
    });
    expect(classifyPosition('Q-test-9', new Set(['Q-test-2', 'Q-test-3']), classes)).toMatchObject({
      pepClass: 1,
    });
  });

  it('lets a refining row override the broader one', () => {
    expect(classifyPosition('Q-test-9', new Set(['Q-test-1', 'Q-test-4']), classes)).toEqual({
      pepClass: 4,
      singleHolder: true,
      headOfStateOrGovernment: false,
    });
  });

  it('holds one holder when any deciding row says so, but never for a class item itself', () => {
    expect(classifyPosition('Q-test-9', new Set(['Q-test-1', 'Q-test-2']), classes)).toEqual({
      pepClass: 1,
      singleHolder: true,
      headOfStateOrGovernment: true,
    });
    expect(classifyPosition('Q-test-1', new Set(['Q-test-1']), classes)).toMatchObject({
      singleHolder: false,
    });
  });

  it('answers null when no known row reached the position', () => {
    expect(classifyPosition('Q-test-9', new Set(), classes)).toBeNull();
    expect(classifyPosition('Q-test-9', new Set(['Q-test-8']), classes)).toBeNull();
  });
});

describe('pepPositionsFileSchema', () => {
  const file = (classes: readonly PepPositionClass[]) => ({
    description: 'Synthetic table.',
    verified: { date: '2026-10-27', method: 'Synthetic.' },
    sources: { 'fatf-2013': 'Synthetic.', authored: 'Synthetic.' },
    classes,
  });

  it('refuses a QID listed twice and a row refining a QID the table lacks', () => {
    expect(pepPositionsFileSchema.safeParse(file([row('Q1'), row('Q2')])).success).toBe(true);
    expect(pepPositionsFileSchema.safeParse(file([row('Q1'), row('Q1')])).success).toBe(false);
    expect(
      pepPositionsFileSchema.safeParse(file([row('Q1', { refines: ['Q3'] }), row('Q2')])).success,
    ).toBe(false);
    expect(pepPositionsFileSchema.safeParse(file([row('Q-test-1')])).success).toBe(false);
  });
});
