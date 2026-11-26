/**
 * `POST /inquiries/:id/perform-simulate-actions` (contract C10): sandbox environments can move
 * an inquiry through its lifecycle without an end user. Each action is the real transition to
 * its target status (`SIMULATE_ACTION_TARGET_STATUS`), with the same events and effects as
 * the real action, and is audited as simulated. The actions run in order in one transaction:
 * if any is not a valid transition, none is applied.
 */
import {
  SIMULATE_ACTION_TARGET_STATUS,
  type InquiryResource,
  type InquirySimulateAction,
} from '@openverify/contracts';
import { lockInquiry } from '@openverify/db';
import type { StagedEvent } from '../events/index.js';
import { NotFoundError, SandboxOnlyError } from '../errors.js';
import type { ApiDependencies } from './context.js';
import { applyInquiryAction, findInquiry, inquiryResourceOf, type Acting } from './inquiries.js';
import { deleteObjects } from './selfie-captures.js';

/**
 * Runs `actions` on the inquiry in order.
 * @throws {SandboxOnlyError} in a production environment, before anything is read.
 * @throws {NotFoundError} when the inquiry is not in this environment.
 * @throws {InvalidTransitionError} when an action is not allowed from the status it meets.
 */
export async function performSimulateActions(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  actions: readonly { type: InquirySimulateAction }[],
): Promise<InquiryResource> {
  if (acting.environmentKind !== 'sandbox') {
    throw new SandboxOnlyError('Simulate actions are only available in sandbox environments.');
  }
  const { db, events } = deps;
  const { environmentId } = acting.ctx;
  const { inquiry, staged, storageKeys } = await db.transaction(async (tx) => {
    if ((await lockInquiry(tx, environmentId, id)) === null) {
      throw new NotFoundError(`Inquiry ${id} was not found.`);
    }
    let current = await findInquiry(tx, environmentId, id);
    const written: StagedEvent[] = [];
    const orphaned: string[] = [];
    for (const { type } of actions) {
      const result = await applyInquiryAction(
        tx,
        deps,
        acting,
        current,
        SIMULATE_ACTION_TARGET_STATUS[type],
        { simulated: true },
      );
      current = result.inquiry;
      written.push(...result.staged);
      orphaned.push(...result.storageKeys);
    }
    return { inquiry: current, staged: written, storageKeys: orphaned };
  });
  await events.dispatch(staged);
  await deleteObjects(deps.storage, storageKeys);
  return inquiryResourceOf(db, environmentId, inquiry, acting.mask);
}
