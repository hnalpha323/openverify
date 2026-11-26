/**
 * C97.4 (Workflow 7B; F16, P08): the hook `updateDashboardSettings` calls in its transaction after
 * writing the environment's settings. Clearing `biometric-lists-basis` redacts every face and
 * background list and its items: the rows go in this transaction, so a settings update that fails
 * redacts nothing. `foundation-7b` (Stage 1b (L)) froze the signature, which has no storage: the
 * `list-item-embed-sweep` purges the masked objects, whose keys stay on their rows. Every list's
 * `version` moves, which is how each worker's decrypted cache drops its copy (`matcher.ts`).
 */
import { redactBiometricLists, type Db, type EnvironmentSettings } from '@openverify/db';
import {
  createOutboxOnlyPublisher,
  type StagedEvent,
  type TransactionalEventPublisher,
} from '../../../events/index.js';
import { stageListUpdated } from '../../../workflows/actions/lists/list-updated.js';
import { redactDecisionCommentsInTx } from '../../decisions/redaction.js';

export type OnSettingsChangedInTx = (
  tx: Db,
  environmentId: string,
  before: EnvironmentSettings,
  after: EnvironmentSettings,
  deps?: { events: TransactionalEventPublisher },
) => Promise<StagedEvent[]>;

export const onSettingsChangedInTx: OnSettingsChangedInTx = async (
  tx,
  environmentId,
  before,
  after,
  deps = { events: createOutboxOnlyPublisher(tx) },
) => {
  const wasSet = (before['biometric-lists-basis'] ?? null) !== null;
  const isSet = (after['biometric-lists-basis'] ?? null) !== null;
  if (!wasSet || isSet) {
    return [];
  }
  const at = new Date();
  const { changedLists, redactedItemIds } = await redactBiometricLists(tx, environmentId, at);
  if (redactedItemIds.length > 0) {
    await redactDecisionCommentsInTx(tx, { environmentId, subjectIds: redactedItemIds, at });
  }
  // C127.12 (outcome 25): every such list is archived, so `archived`, whatever items it held.
  return changedLists.length === 0
    ? []
    : stageListUpdated(
        tx,
        deps,
        environmentId,
        changedLists.map(({ listId, items }) => ({ listId, changeKind: 'archived', items })),
      );
};
