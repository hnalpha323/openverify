// @ts-check
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_FIELDS,
  canonicalJson,
  executedRunsCheck,
  identityCheck,
  matchDigest,
  switchShare,
} from './benchmark-scale.mjs';

/** A created match as a watchlist run returns it (synthetic values, no real entry). */
const MATCH = Object.freeze({
  sourceId: 'openverify-sandbox',
  entryKey: 'openverify-sandbox:BS-0000001',
  contentHash: 'c1',
  riskDataHash: 'r1',
  matchedName: 'Quorvane Belmira',
  score: 0.91,
  snapshot: {
    entity: { 'entity-id': 'openverify-sandbox:BS-0000001', 'alias-type': 'primary' },
    'match-types': ['name'],
    qualifiers: ['dob_exact'],
    components: {
      'list-name': 'Quorvane Belmira',
      'name-level': 'full',
      methods: ['equal', 'typo'],
    },
  },
});

const sha256 = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');

describe('canonicalJson and matchDigest (owner decision 8 after 6C)', () => {
  it('sorts object members, keeps array order, and digests the whole created matches', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }] })).toBe(
      '{"a":[2,{"c":"x","d":null}],"b":1}',
    );
    expect(matchDigest([])).toBe(sha256('[]'));
    expect(matchDigest([MATCH])).toBe(sha256(canonicalJson([MATCH])));

    const reordered = Object.fromEntries(Object.entries(MATCH).reverse());
    expect(matchDigest([reordered])).toBe(matchDigest([MATCH]));
  });

  it('moves with every member a run returns, and with the matches’ order', () => {
    const other = { ...MATCH, entryKey: 'openverify-sandbox:BS-0000002' };
    const variants = [
      { ...MATCH, score: 0.9 },
      { ...MATCH, entryKey: 'openverify-sandbox:BS-0000009' },
      { ...MATCH, matchedName: 'Quorvan Belmira' },
      { ...MATCH, snapshot: { ...MATCH.snapshot, 'match-types': ['name', 'identifier'] } },
      { ...MATCH, snapshot: { ...MATCH.snapshot, qualifiers: [] } },
      {
        ...MATCH,
        snapshot: { ...MATCH.snapshot, entity: { ...MATCH.snapshot.entity, 'alias-type': 'weak' } },
      },
      {
        ...MATCH,
        snapshot: {
          ...MATCH.snapshot,
          components: { ...MATCH.snapshot.components, methods: ['typo', 'equal'] },
        },
      },
      {
        ...MATCH,
        snapshot: {
          ...MATCH.snapshot,
          components: { ...MATCH.snapshot.components, 'name-level': 'partial' },
        },
      },
    ];
    const digests = new Set([MATCH, ...variants].map((match) => matchDigest([match])));

    expect(digests.size).toBe(variants.length + 1);
    expect(matchDigest([MATCH, other])).not.toBe(matchDigest([other, MATCH]));
  });
});

/**
 * @param {string} key
 * @param {Record<string, Record<string, unknown>>} presets
 */
const line = (key, presets) => ({ key, presets });
const RUN = { matched: ['HZ-1'], fixed: 2, limits: [], errors: [], digest: 'd1' };

describe('identityCheck (owner decision 8 after 6C)', () => {
  it('compares by query and preset, whatever order the resumed steps wrote the lines in', () => {
    const base = [
      line('a', { exact: RUN, tolerant: { ...RUN, digest: 'd2' } }),
      line('b', { exact: { ...RUN, matched: [] } }),
    ];
    const head = [...base].reverse();

    const result = identityCheck(base, head);

    expect(result).toEqual({
      queries: { base: 2, head: 2, both: 2 },
      compared: 3,
      identical: 3,
      differing: 0,
      byField: { matched: 0, fixed: 0, limits: 0, errors: 0, digest: 0 },
      only: { base: 0, head: 0 },
      undigested: 0,
      examples: [],
      same: true,
    });
    expect(IDENTITY_FIELDS).toEqual(['matched', 'fixed', 'limits', 'errors', 'digest']);
  });

  it('names each field that differs, and the queries one run alone holds', () => {
    const base = [
      line('a', { exact: RUN, strict: RUN }),
      line('b', { exact: RUN }),
      line('c', { exact: RUN }),
    ];
    const head = [
      line('a', { exact: { ...RUN, digest: 'other' }, strict: { ...RUN, limits: ['truncated'] } }),
      line('b', { exact: { ...RUN, matched: ['HZ-1', 'HZ-2'], fixed: 3 } }),
      line('d', { exact: RUN }),
    ];

    const result = identityCheck(base, head, { examples: 2 });

    expect(result.queries).toEqual({ base: 3, head: 3, both: 2 });
    expect(result.compared).toBe(3);
    expect(result.differing).toBe(3);
    expect(result.byField).toEqual({ matched: 1, fixed: 1, limits: 1, errors: 0, digest: 1 });
    expect(result.only).toEqual({ base: 1, head: 1 });
    expect(result.examples).toEqual([
      { key: 'a', preset: 'exact', fields: ['digest'] },
      { key: 'a', preset: 'strict', fields: ['limits'] },
    ]);
    expect(result.same).toBe(false);
  });

  it('is not the same when a preset carries no digest, or one run lacks a preset', () => {
    const { digest, ...undigested } = RUN;
    void digest;
    const result = identityCheck(
      [line('a', { exact: undigested, strict: RUN })],
      [line('a', { exact: undigested })],
    );

    expect(result.undigested).toBe(1);
    expect(result.compared).toBe(2);
    expect(result.identical).toBe(1);
    expect(result.differing).toBe(1);
    expect(result.same).toBe(false);
  });
});

describe('switchShare (owner decision 8 after 6C)', () => {
  it('pairs each off round with the on round after it, and takes the median and range of on − off', () => {
    const share = switchShare([
      { state: 'off', p95: 120 },
      { state: 'on', p95: 100 },
      { state: 'off', p95: 130 },
      { state: 'on', p95: 104 },
      { state: 'off', p95: 110 },
      { state: 'on', p95: 108 },
    ]);

    expect(share.takes).toEqual([
      { off: 120, on: 100, worse: -20 },
      { off: 130, on: 104, worse: -26 },
      { off: 110, on: 108, worse: -2 },
    ]);
    expect(share.medianOff).toBe(120);
    expect(share.medianOn).toBe(104);
    expect(share.medianWorse).toBe(-20);
    expect(share.range).toEqual([-26, -2]);
    expect(share.relativeWorse).toBeCloseTo(-20 / 120, 12);
  });

  it('refuses rounds that do not alternate off then on', () => {
    expect(() => switchShare([])).toThrow(RangeError);
    expect(() =>
      switchShare([
        { state: 'on', p95: 1 },
        { state: 'off', p95: 1 },
      ]),
    ).toThrow(RangeError);
    expect(() => switchShare([{ state: 'off', p95: 1 }])).toThrow(RangeError);
  });
});

describe('executedRunsCheck (owner decision 8 after 6C, review C004)', () => {
  it('passes when every inserted run, executed, keeps a match on a changed entry', () => {
    const result = executedRunsCheck({
      runs: ['r1', 'r2'],
      lines: [
        { reportId: 'r1', changed: 1, kept: 3, errors: [] },
        { reportId: 'r2', changed: 2, kept: 2, errors: [] },
      ],
      full: [
        { reportId: 'r1', changed: 1 },
        { reportId: 'r2', changed: 1 },
        { reportId: 'r9', changed: 4 },
      ],
    });

    expect(result).toEqual({
      runs: 2,
      executed: 2,
      missing: 0,
      keptChanged: 2,
      missed: 0,
      errored: 0,
      errorCodes: [],
      matchesOnChangedEntries: 3,
      full: { subjects: 2, covered: 2, short: 0 },
      subjects: null,
      pass: true,
    });
  });

  it('digests the subjects the runs screened, whatever their order, so two trees can be compared without their report ids', () => {
    const first = { reportId: 'r1', changed: 1, kept: 1, errors: [], subject: 's-b' };
    const second = { reportId: 'r2', changed: 1, kept: 1, errors: [], subject: 's-a' };
    const one = executedRunsCheck({ runs: ['r1', 'r2'], lines: [first, second] });
    const other = executedRunsCheck({
      runs: ['q2', 'q1'],
      lines: [
        { ...second, reportId: 'q2' },
        { ...first, reportId: 'q1' },
      ],
    });
    const { subject, ...bare } = first;
    void subject;

    expect(one.subjects).toBe(sha256('s-a\ns-b'));
    expect(other.subjects).toBe(one.subjects);
    expect(executedRunsCheck({ runs: ['r1', 'r2'], lines: [bare, second] }).subjects).toBeNull();
  });

  it('fails on a run that keeps no changed entry or has no line, counting a resumed line once', () => {
    const result = executedRunsCheck({
      runs: ['r1', 'r2', 'r3'],
      lines: [
        { reportId: 'r1', changed: 0, kept: 1, errors: ['result_truncated'] },
        { reportId: 'r1', changed: 0, kept: 1, errors: ['result_truncated'] },
        { reportId: 'r2', changed: 1, kept: 1, errors: [] },
      ],
      full: [{ reportId: 'r2', changed: 2 }],
    });

    expect(result.executed).toBe(2);
    expect(result.missing).toBe(1);
    expect(result.missed).toBe(1);
    expect(result.errored).toBe(1);
    expect(result.errorCodes).toEqual(['result_truncated']);
    expect(result.full).toEqual({ subjects: 1, covered: 0, short: 1 });
    expect(result.pass).toBe(false);
    expect(executedRunsCheck({ runs: [], lines: [] }).full).toBeNull();
  });
});

const PACKAGE = join(import.meta.dirname, '..');

/**
 * Runs one benchmark CLI as its package script does (the script's own node flags), with `args`.
 * @param {'benchmark:quality' | 'benchmark:performance'} script
 * @param {string[]} args
 */
async function runCli(script, args) {
  /** @type {Record<string, string>} */
  const scripts = JSON.parse(await readFile(join(PACKAGE, 'package.json'), 'utf8')).scripts;
  const [command, ...flags] = (scripts[script] ?? '').split(' ');
  expect(command).toBe('node');
  return promisify(execFile)(process.execPath, [...flags, ...args], { cwd: PACKAGE });
}

describe('the identity steps’ outputs (Workflow 6D review, calibration-6d amendment 4)', () => {
  it('gives each CLI its own file name, so one --out directory holds both records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openverify-identity-'));
    try {
      const base = join(root, 'base');
      const head = join(root, 'head');
      const out = join(root, 'out');
      await Promise.all([mkdir(base), mkdir(head)]);
      const args = ['--step', 'identity', '--base', base, '--head', head, '--out', out];

      await runCli('benchmark:quality', args);
      await runCli('benchmark:performance', args);

      expect((await readdir(out)).sort()).toEqual([
        'performance-identity.json',
        'quality-identity.json',
      ]);
      const quality = JSON.parse(await readFile(join(out, 'quality-identity.json'), 'utf8'));
      const performance = JSON.parse(
        await readFile(join(out, 'performance-identity.json'), 'utf8'),
      );
      expect(quality).toEqual({ base, head, sets: {}, same: false });
      expect(performance).toEqual({ base, head, scales: {}, same: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // A hang guard, not a budget: two real child processes, which took over 60 s at a load of 47.
  }, 180_000);
});
