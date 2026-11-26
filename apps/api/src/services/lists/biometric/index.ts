/**
 * C97.4, C98.4, C99.7 (Workflow 7B; F08): the biometric list ports' implementations that need only
 * the database. `foundation-7b` (Stage 1b (L)) froze the ports (`ports.ts`), with in-memory fakes in
 * `test-support/fakes.ts`. The matcher, which needs vision and the worker's cache, is in
 * `matcher.ts`, so that a transition hook importing this file loads neither.
 *
 * - {@link biometricItemRedactor} and {@link biometricListsGate} are the real ports.
 * - `unbuiltBiometricListsGate` says no, and `unbuiltBiometricListMatcher` reads no list and says
 *   so: every list is `unscreened`, never "no match" (H02). They are what a process answers with
 *   neither wired.
 */
import {
  listBiometricItemsBySource,
  readBiometricListsBasis,
  redactBiometricItems,
} from '@openverify/db';
import type {
  BiometricItemRedactor,
  BiometricListMatcher,
  BiometricListsGate,
} from '../../../ports.js';

/** C98.4, C99.7: the items an inquiry was the source of go in its redaction's transaction. */
export const biometricItemRedactor: BiometricItemRedactor = {
  async redactBySource(tx, { environmentId, inquiryId, at }) {
    const items = await listBiometricItemsBySource(tx, environmentId, inquiryId);
    return redactBiometricItems(
      tx,
      environmentId,
      items.map(({ itemId }) => itemId),
      { at },
    );
  },
};

/**
 * C97.4 (F16): whether `biometric-lists-basis` is set, under a shared lock of the environment, so a
 * caller in a transaction commits before the basis can be cleared.
 */
export const biometricListsGate: BiometricListsGate = {
  isAcknowledged: async (db, environmentId) =>
    (await readBiometricListsBasis(db, environmentId)) !== null,
};

export const unbuiltBiometricListsGate: BiometricListsGate = {
  isAcknowledged: () => Promise.resolve(false),
};

export const unbuiltBiometricListMatcher: BiometricListMatcher = {
  match: ({ lists }) =>
    Promise.resolve({
      matches: [],
      unscreened: lists.map(({ id }) => ({ 'list-id': id, reason: 'list_items_pending' as const })),
      compared: [],
    }),
};
