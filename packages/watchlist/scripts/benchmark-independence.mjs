// @ts-check
/**
 * The independence of the watchlist evaluation (evaluation-6, plan C78.8, H21, V12): the measured
 * variant-group build must be a hold-out build of the pinned source for the evaluation seed, and no
 * group a held-out case draws on may survive in it. The benchmark stops before any screening when
 * this fails. Also a diagnostic: whether two written forms share a group of the measured build
 * (another group can hold both forms, which is knowledge the matcher legitimately has).
 *
 * Messages carry counts only, never a group id or a form.
 */
import { variantFormsOf } from '../src/keys/index.js';
import { isHeldOutGroup } from '../src/record/index.js';

/** The format tag of a filtered variant-group file. */
export const VARIANT_GROUP_BUILD_FORMAT = 'openverify/variant-groups/v1';

/** The measured build breaks the evaluation's independence. */
export class HeldOutLeakError extends Error {
  /** @override */
  name = 'HeldOutLeakError';
}

/**
 * @typedef {object} VariantGroupBuild
 * @property {boolean} heldOut Whether the build dropped a seed's held-out groups.
 * @property {string} sourceSha256 The SHA-256 of the source it was filtered from.
 * @property {ReadonlySet<string>} groupIds Every group it kept.
 */

/**
 * @typedef {object} HeldOutCaseGroups
 * @property {string} variantSource
 * @property {readonly string[]} groupIds
 */

const SHA256 = /^[0-9a-f]{64}$/u;

/** @param {number} count @param {string} one @param {string} many */
const plural = (count, one, many) => `${String(count)} ${count === 1 ? one : many}`;

/**
 * Reads the header and the group ids of a filtered variant-group file (no form is kept).
 * @param {string} text
 * @returns {VariantGroupBuild}
 */
export function readVariantGroupBuild(text) {
  /** @type {{ format?: unknown, heldOut?: unknown, source?: { sha256?: unknown }, groups?: unknown }} */
  const file = JSON.parse(text);
  if (file.format !== VARIANT_GROUP_BUILD_FORMAT) {
    throw new Error('not a filtered variant-group file (format)');
  }
  const sha256 = file.source?.sha256;
  if (typeof file.heldOut !== 'boolean' || typeof sha256 !== 'string' || !SHA256.test(sha256)) {
    throw new Error('not a filtered variant-group file (header)');
  }
  if (!Array.isArray(file.groups)) {
    throw new Error('not a filtered variant-group file (groups)');
  }
  const groupIds = new Set(
    file.groups.map((/** @type {unknown} */ group) => {
      const id = Array.isArray(group) ? /** @type {unknown} */ (group[0]) : undefined;
      if (typeof id !== 'string' || id === '') {
        throw new Error('not a filtered variant-group file (group id)');
      }
      return id;
    }),
  );
  return { heldOut: file.heldOut, sourceSha256: sha256, groupIds };
}

/**
 * V12: stops unless the build is a hold-out build of the pinned source for `seed` and no group of
 * a held-out case survives in it; returns what it checked.
 * @param {{ seed: string, build: VariantGroupBuild, pinnedSourceSha256: string,
 *   cases: readonly HeldOutCaseGroups[], heldOutGroupIds: readonly string[] }} input
 * @returns {{ groupCases: number, groupIds: number }}
 */
export function assertHeldOutIndependence(input) {
  const { build, seed } = input;
  if (!build.heldOut) {
    throw new HeldOutLeakError('the measured build is not a hold-out build');
  }
  if (build.sourceSha256 !== input.pinnedSourceSha256) {
    throw new HeldOutLeakError('the measured build is not filtered from the pinned source');
  }
  const groupCases = input.cases.filter((item) => item.variantSource.startsWith('held_out_group'));
  if (groupCases.some((item) => item.groupIds.length === 0)) {
    throw new HeldOutLeakError('a held-out group case names no group');
  }
  const declared = new Set(input.heldOutGroupIds);
  const drawn = new Set(input.cases.flatMap((item) => item.groupIds));
  if ([...drawn].some((id) => !declared.has(id))) {
    throw new HeldOutLeakError('a case group is missing from the set’s held-out group ids');
  }
  const notHeld = [...declared].filter((id) => !isHeldOutGroup(id, seed)).length;
  if (notHeld > 0) {
    throw new HeldOutLeakError(
      `${plural(notHeld, 'case group is', 'case groups are')} not held out for this seed`,
    );
  }
  const surviving = new Set([...declared].filter((id) => build.groupIds.has(id)));
  if (surviving.size > 0) {
    const affected = input.cases.filter((item) => item.groupIds.some((id) => surviving.has(id)));
    throw new HeldOutLeakError(
      `${plural(surviving.size, 'held-out group survives', 'held-out groups survive')} in the ` +
        `measured build (${plural(affected.length, 'case', 'cases')})`,
    );
  }
  return { groupCases: groupCases.length, groupIds: declared.size };
}

/**
 * Whether two written name forms share a group of `groups`, as the matcher stores forms.
 * @param {string} left
 * @param {string} right
 * @param {import('../src/keys/index.js').VariantGroups} groups
 * @returns {boolean}
 */
export function shareSurvivingGroup(left, right, groups) {
  const of = (/** @type {string} */ form) =>
    new Set(variantFormsOf(form).flatMap((stored) => groups.groupsOf(stored)));
  const mine = of(left);
  return [...of(right)].some((id) => mine.has(id));
}
