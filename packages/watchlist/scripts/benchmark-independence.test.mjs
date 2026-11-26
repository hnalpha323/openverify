// @ts-check
import { describe, expect, it } from 'vitest';
import { serialiseVariantGroups, variantGroupsFrom } from '../src/keys/index.js';
import { isHeldOutGroup } from '../src/record/index.js';
import {
  HeldOutLeakError,
  assertHeldOutIndependence,
  readVariantGroupBuild,
  shareSurvivingGroup,
} from './benchmark-independence.mjs';

const SEED = 'test-only-seed';
const PINNED = 'b'.repeat(64);
const candidates = Array.from({ length: 600 }, (_, index) => `Q${String(index + 1)}`);
const held = candidates.filter((id) => isHeldOutGroup(id, SEED));
const kept = candidates.filter((id) => !isHeldOutGroup(id, SEED));
const [heldA = '', heldB = '', heldC = ''] = held;
const [keptA = '', keptB = ''] = kept;

/** A build text keeping `ids`, each with two placeholder forms. */
const buildText = (/** @type {string[]} */ ids, heldOut = true, source = PINNED) =>
  serialiseVariantGroups(
    ids.map((id) => /** @type {const} */ ([id, [`${id.toLowerCase()}a`, `${id.toLowerCase()}b`]])),
    { sourceSha256: source, heldOut },
  );

describe('readVariantGroupBuild', () => {
  it('reads the header and the kept group ids of a filtered file', () => {
    const build = readVariantGroupBuild(buildText([keptA, keptB]));

    expect(build.heldOut).toBe(true);
    expect(build.sourceSha256).toBe(PINNED);
    expect([...build.groupIds].sort()).toEqual([keptA, keptB].sort());
  });

  it('refuses a file in another format', () => {
    expect(() => readVariantGroupBuild('{"format":"other","groups":[]}')).toThrow(/format/);
    expect(() => readVariantGroupBuild('not json')).toThrow();
    expect(() =>
      readVariantGroupBuild(
        JSON.stringify({ format: 'openverify/variant-groups/v1', heldOut: 'yes', groups: [] }),
      ),
    ).toThrow();
  });
});

describe('assertHeldOutIndependence (V12)', () => {
  const cases = [
    { variantSource: 'held_out_group_cross_script', groupIds: [heldA, heldB] },
    { variantSource: 'held_out_group_same_script', groupIds: [heldB, heldC] },
    { variantSource: 'typo', groupIds: [] },
  ];

  it('passes when the build is a hold-out build of the pinned source and keeps no case group', () => {
    const result = assertHeldOutIndependence({
      seed: SEED,
      build: readVariantGroupBuild(buildText([keptA, keptB])),
      pinnedSourceSha256: PINNED,
      cases,
      heldOutGroupIds: [heldA, heldB, heldC],
    });

    expect(result).toEqual({ groupCases: 2, groupIds: 3 });
  });

  it('stops when a case group survives in the measured build, naming counts only', () => {
    const run = () =>
      assertHeldOutIndependence({
        seed: SEED,
        build: readVariantGroupBuild(buildText([keptA, heldB])),
        pinnedSourceSha256: PINNED,
        cases,
        heldOutGroupIds: [heldA, heldB, heldC],
      });

    expect(run).toThrow(HeldOutLeakError);
    expect(run).toThrow('1 held-out group survives in the measured build (2 cases)');
    expect(run).not.toThrow(heldB);
  });

  it('stops for a build that is not a hold-out build, or not from the pinned source', () => {
    expect(() =>
      assertHeldOutIndependence({
        seed: SEED,
        build: readVariantGroupBuild(buildText([keptA], false)),
        pinnedSourceSha256: PINNED,
        cases,
        heldOutGroupIds: [heldA, heldB, heldC],
      }),
    ).toThrow(HeldOutLeakError);
    expect(() =>
      assertHeldOutIndependence({
        seed: SEED,
        build: readVariantGroupBuild(buildText([keptA], true, 'c'.repeat(64))),
        pinnedSourceSha256: PINNED,
        cases,
        heldOutGroupIds: [heldA, heldB, heldC],
      }),
    ).toThrow(/pinned/);
  });

  it('stops when a case draws on a group this seed does not hold out', () => {
    expect(() =>
      assertHeldOutIndependence({
        seed: SEED,
        build: readVariantGroupBuild(buildText([keptB])),
        pinnedSourceSha256: PINNED,
        cases: [{ variantSource: 'held_out_group_cross_script', groupIds: [heldA, keptA] }],
        heldOutGroupIds: [heldA, keptA],
      }),
    ).toThrow('1 case group is not held out for this seed');
  });

  it('stops when a group case names no group, or a case group is missing from the set', () => {
    const build = readVariantGroupBuild(buildText([keptA]));
    expect(() =>
      assertHeldOutIndependence({
        seed: SEED,
        build,
        pinnedSourceSha256: PINNED,
        cases: [{ variantSource: 'held_out_group_same_script', groupIds: [] }],
        heldOutGroupIds: [],
      }),
    ).toThrow(/names no group/);
    expect(() =>
      assertHeldOutIndependence({
        seed: SEED,
        build,
        pinnedSourceSha256: PINNED,
        cases: [{ variantSource: 'held_out_group_same_script', groupIds: [heldA] }],
        heldOutGroupIds: [heldB],
      }),
    ).toThrow(/held-out group ids/);
  });
});

describe('shareSurvivingGroup (a diagnostic)', () => {
  const groups = variantGroupsFrom(
    /** @type {const} */ ([
      ['Q9', ['Mohammed', 'Мухаммед']],
      ['Q10', ['Anna', 'Анна']],
    ]),
    'd'.repeat(64),
  );

  it('says whether two written forms share a group, as the matcher stores forms', () => {
    expect(shareSurvivingGroup('Mohammed', 'Мухаммед', groups)).toBe(true);
    expect(shareSurvivingGroup('MOHAMMED', 'мухаммед', groups)).toBe(true);
    expect(shareSurvivingGroup('Mohammed', 'Анна', groups)).toBe(false);
    expect(shareSurvivingGroup('Quillfeather', 'Мухаммед', groups)).toBe(false);
  });
});
