/**
 * C78.3, V12: which variant groups the `--hold-out <seed>` build drops and the held-out generator
 * draws its cross-script cases from, frozen in Workflow 6A Stage 1a with golden vectors. A group is
 * held out when the first byte of SHA-256 over the canonical JSON of
 * `["openverify/held-out/v1", seed, groupId]` is below 26: about a tenth of the groups (26/256).
 * Nobody knows the held-out groups before `evaluation-6` picks its seed; the shipped build keeps
 * every group.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';

/** The first-byte threshold: a group whose digest starts below it is held out. */
export const HELD_OUT_BYTE_THRESHOLD = 26;

/** Whether the build for `seed` holds out the variant group `groupId` (C78.3). */
export function isHeldOutGroup(groupId: string, seed: string): boolean {
  const digest = createHash('sha256')
    .update(canonicalJson(['openverify/held-out/v1', seed, groupId]), 'utf8')
    .digest();
  return (digest[0] ?? 0xff) < HELD_OUT_BYTE_THRESHOLD;
}
