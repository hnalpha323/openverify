// @ts-check
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../src/testing/random.js';
import { withTypo } from '../src/testing/held-out/index.js';
import { wilsonInterval } from './benchmark-metrics.mjs';
import {
  TYPO_BUDGET_LENGTH,
  TYPO_EDIT_KINDS,
  rescreenCheck,
  rescreenSubject,
  rescreenSubjectLines,
  typoEdit,
  typoKindBreakdown,
  unlistedAlerts,
} from './benchmark-posthoc.mjs';

/** @typedef {import('./benchmark-metrics.mjs').TimedScreening} TimedScreening */

describe('typoEdit', () => {
  it('names the one edit between a listed and a typed token', () => {
    expect(typoEdit('Brakinton', 'Brakimton')).toEqual({ kind: 'substitute', at: 5 });
    expect(typoEdit('Brakinton', 'Brakington')).toEqual({ kind: 'insert', at: 6 });
    expect(typoEdit('Brakinton', 'Brakiton')).toEqual({ kind: 'delete', at: 5 });
    expect(typoEdit('Brakinton', 'Brakintno')).toEqual({ kind: 'transpose', at: 7 });
    expect(typoEdit('Brakinton', 'Barkinton')).toEqual({ kind: 'transpose', at: 1 });
  });

  it('is null for equal tokens, two edits or more, and lengths apart by two', () => {
    expect(typoEdit('Brakinton', 'Brakinton')).toBeNull();
    expect(typoEdit('Brakinton', 'Brekintan')).toBeNull();
    expect(typoEdit('Brakinton', 'Brakinto')).toEqual({ kind: 'delete', at: 8 });
    expect(typoEdit('Brakinton', 'Brakint')).toBeNull();
    expect(typoEdit('Brakinton', 'Bkarinton')).toBeNull();
    expect(typoEdit('Anna', 'Annna')).toEqual({ kind: 'insert', at: 3 });
  });

  it('reads back every kind the held-out generator writes', () => {
    const random = seededRandom('posthoc/typos');
    for (const kind of TYPO_EDIT_KINDS) {
      for (let index = 0; index < 200; index += 1) {
        const token = random.pick(['Quillfeather', 'Brakinton', 'Velmira', 'Osk', 'Anna']);
        expect(typoEdit(token, withTypo(random, token, kind))?.kind, `${kind} of ${token}`).toBe(
          kind,
        );
      }
    }
  });
});

describe('typoKindBreakdown', () => {
  /** @type {import('./benchmark-posthoc.mjs').TypoObservation[]} */
  const items = [
    { subject: 'persons', kind: 'substitute', length: 9, found: { strict: false, tolerant: true } },
    {
      subject: 'persons',
      kind: 'substitute',
      length: 4,
      found: { strict: false, tolerant: false },
    },
    { subject: 'persons', kind: 'transpose', length: 9, found: { strict: false, tolerant: false } },
    { subject: 'persons', kind: 'transpose', length: 8, found: { strict: false, tolerant: false } },
    { subject: 'companies', kind: 'delete', length: 6, found: { strict: false, tolerant: true } },
    { subject: 'companies', kind: null, length: 6, found: { strict: true, tolerant: true } },
  ];

  it('counts recall by subject, kind and token length at each preset, with Wilson intervals', () => {
    const rows = typoKindBreakdown(items, ['strict', 'tolerant']);
    const row = (
      /** @type {string} */ subject,
      /** @type {string} */ kind,
      /** @type {string} */ length,
    ) =>
      rows.find((item) => item.subject === subject && item.kind === kind && item.length === length);

    expect(TYPO_BUDGET_LENGTH).toBe(5);
    expect(row('persons', 'substitute', 'all')?.presets).toEqual({
      strict: { found: 0, of: 2, share: 0, wilson: wilsonInterval(0, 2) },
      tolerant: { found: 1, of: 2, share: 0.5, wilson: wilsonInterval(1, 2) },
    });
    expect(row('persons', 'substitute', 'long')?.presets.tolerant).toMatchObject({
      found: 1,
      of: 1,
    });
    expect(row('persons', 'substitute', 'short')?.presets.tolerant).toMatchObject({
      found: 0,
      of: 1,
    });
    expect(row('persons', 'transpose', 'all')?.presets.tolerant).toMatchObject({ found: 0, of: 2 });
    expect(row('persons', 'transpose', 'short')).toBeUndefined();
    expect(row('companies', 'unclassified', 'all')?.presets.strict).toMatchObject({
      found: 1,
      of: 1,
    });
    expect(rows.map((item) => `${item.subject}/${item.kind}/${item.length}`)).toEqual([
      'persons/substitute/all',
      'persons/substitute/short',
      'persons/substitute/long',
      'persons/transpose/all',
      'persons/transpose/long',
      'companies/delete/all',
      'companies/delete/long',
      'companies/unclassified/all',
      'companies/unclassified/long',
    ]);
  });

  it('is empty without typo cases', () => {
    expect(typoKindBreakdown([], ['tolerant'])).toEqual([]);
  });
});

describe('unlistedAlerts', () => {
  /** @type {(round: number, subject: 'listed' | 'unlisted', kept: number) => TimedScreening} */
  const timing = (round, subject, kept) => ({
    round,
    subject,
    ms: 10,
    phases: { state: 1, retrieve: 2, load: 3 },
    candidates: 5,
    truncated: false,
    kept,
    found: subject === 'listed' ? true : null,
  });

  it('counts the first round’s unlisted subjects with a kept match, with a Wilson interval', () => {
    const timings = [
      timing(2, 'unlisted', 9),
      timing(1, 'listed', 4),
      timing(1, 'unlisted', 0),
      timing(1, 'unlisted', 3),
      timing(1, 'unlisted', 1),
      timing(1, 'unlisted', 0),
      timing(3, 'unlisted', 0),
    ];

    expect(unlistedAlerts(timings)).toEqual({
      round: 1,
      alerted: 2,
      of: 4,
      share: 0.5,
      interval: wilsonInterval(2, 4),
      matches: 4,
    });
  });

  it('refuses a run without unlisted subjects', () => {
    expect(() => unlistedAlerts([timing(1, 'listed', 1)])).toThrow(RangeError);
  });
});

describe('the re-screen no-miss check (owner decision 3 after 6B, review C003)', () => {
  const CHANGED = new Set(['BA1000-1', 'BA1000-2', 'BA1000-3']);

  it('counts a subject’s kept matches on the changed entries, and keeps its error codes', () => {
    expect(rescreenSubject('rep_a', ['SYN-1', 'BA1000-2', 'BA1000-3'], CHANGED, [])).toEqual({
      reportId: 'rep_a',
      changed: 2,
      kept: 3,
      errors: [],
    });
    expect(rescreenSubject('rep_b', [], CHANGED, ['result_truncated'])).toEqual({
      reportId: 'rep_b',
      changed: 0,
      kept: 0,
      errors: ['result_truncated'],
    });
  });

  it('finds the subjects matched on a changed entry without a run, and the runs without such a match', () => {
    const subjects = [
      rescreenSubject('rep_hit_run', ['BA1000-1'], CHANGED, []),
      rescreenSubject('rep_hit_missed', ['BA1000-2', 'SYN-9'], CHANGED, []),
      rescreenSubject('rep_other', ['SYN-9'], CHANGED, ['result_truncated']),
      rescreenSubject('rep_none', [], CHANGED, []),
      // A resumed call screened this subject again: its last line counts.
      rescreenSubject('rep_hit_missed', ['BA1000-2', 'BA1000-3'], CHANGED, []),
    ];

    expect(
      rescreenCheck({
        changedEntries: CHANGED.size,
        runs: ['rep_hit_run', 'rep_other'],
        subjects,
      }),
    ).toEqual({
      changedEntries: 3,
      listUpdateRuns: 2,
      subjectsScreened: 4,
      erroredSubjects: 1,
      errorCodes: ['result_truncated'],
      fullScreeningMatchesChanged: 2,
      ofThemWithRun: 1,
      missed: 1,
      missedWilson: wilsonInterval(1, 2),
      runsWithoutFullScreeningMatch: 1,
      matchesOnChangedEntries: 3,
    });
  });

  it('reads only the complete lines of a worker file another worker may be appending to', () => {
    const line = (/** @type {string} */ reportId) =>
      JSON.stringify(rescreenSubject(reportId, [], CHANGED, []));

    expect(
      rescreenSubjectLines(`${line('rep_a')}\n${line('rep_b')}\n`).map((item) => item.reportId),
    ).toEqual(['rep_a', 'rep_b']);
    expect(
      rescreenSubjectLines(`${line('rep_a')}\n${line('rep_b').slice(0, 12)}`).map(
        (item) => item.reportId,
      ),
    ).toEqual(['rep_a']);
    expect(rescreenSubjectLines('')).toEqual([]);
  });

  it('reports no miss when every matched subject has a run, with a Wilson bound', () => {
    const check = rescreenCheck({
      changedEntries: 1,
      runs: ['rep_a'],
      subjects: [rescreenSubject('rep_a', ['BA1000-1'], CHANGED, [])],
    });

    expect(check).toMatchObject({
      missed: 0,
      ofThemWithRun: 1,
      missedWilson: wilsonInterval(0, 1),
    });
    expect(rescreenCheck({ changedEntries: 0, runs: [], subjects: [] }).missedWilson).toBeNull();
  });
});
