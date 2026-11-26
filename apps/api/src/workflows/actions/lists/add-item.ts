/**
 * C127.4, C128: `add_list_item` and `add_face_list_item`, with the run as creator. An add to a list
 * whose purpose is `block` is adverse (C122.1): it passes C128's gate and leaves a decision record on
 * the item; a stopped add leaves the error on a record, `needs-review`, with no item. A value already
 * listed is `no_change`. A face item stays `pending` until the embed job makes it matchable, and
 * `list.updated` follows then (outcome 25). A run adds one face (C127.4).
 */
import { LIST_KIND_REGISTRY, type ListKind } from '@openverify/core';
import { listWorkflowRunEffects, type Db, type Inquiry } from '@openverify/db';
import { newId, type IdPrefix } from '@openverify/contracts';
import {
  addFaceListItemConfigSchema,
  addListItemConfigSchema,
  type AddListItemConfig,
} from '@openverify/workflow-engine/actions';
import { lockedInquiry } from '../../../services/inquiries.js';
import { createBiometricListItemInTx } from '../../../services/lists/biometric/items.js';
import { consumeListWrite } from '../../../services/lists/rate.js';
import { requireList } from '../../../services/lists/lists.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { stepIsBiometric } from '../decisions/biometric.js';
import { runDecisionFactsOf } from '../decisions/facts.js';
import { adverseRefusal } from '../decisions/gate.js';
import { markInquiryForReviewInTx, recordAdverseDecisionInTx } from '../decisions/review.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';
import { stageListUpdated } from './list-updated.js';

const itemIdOf = (kind: ListKind): string => newId(LIST_KIND_REGISTRY[kind].itemPrefix as IdPrefix);

function attributesOf(item: AddListItemConfig['item']) {
  if (item.kind === 'geolocation') {
    return {
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      'radius-meters': Number(item['radius-meters']),
    };
  }
  return Object.fromEntries(Object.entries(item).filter(([member]) => member !== 'kind'));
}

async function factsFor(
  tx: Db,
  context: ActionContext,
  subjectId: string,
  config: Pick<AddListItemConfig, 'decision-basis' | 'contest-route' | 'biometric-basis'>,
) {
  return runDecisionFactsOf(tx, context, subjectId, config);
}

export const ADD_LIST_ITEM_HANDLER: TransactionActionHandler = {
  key: 'add_list_item',
  version: 1,
  shape: 'transaction',
  async execute(tx, context): Promise<ActionResult> {
    const config = configOf(context, addListItemConfigSchema);
    const deps = apiDepsOf(context);
    const { environmentId } = context;
    const listId = config['list-id'];
    const list = await refusing(() => requireList(tx, environmentId, listId));
    if (list.type !== config.item.kind) {
      return { kind: 'failed', code: 'list_kind_mismatch' };
    }
    await refusing(() => consumeListWrite(deps, environmentId));
    const adverse = list.purpose === 'block';
    const subjectId = itemIdOf(list.type);
    const facts = await factsFor(tx, context, subjectId, config);
    const refusal = adverse
      ? await adverseRefusal(tx, context, { facts, biometric: false, inquiryId: null })
      : null;
    if (refusal !== null) {
      await recordAdverseDecisionInTx(tx, context, {
        subjectType: 'list-item',
        subjectId,
        facts,
        needsReview: true,
        errorCode: refusal,
      });
      return { kind: 'failed', code: refusal };
    }
    const { listService } = context.services;
    if (listService === undefined) {
      throw new ActionStepError('provider_not_configured');
    }
    const { id, alreadyPresent } = await refusing(() =>
      listService.createItemInTx(tx, {
        environmentId,
        listId,
        item: {
          attributes: attributesOf(config.item),
          creator: { type: 'workflow-run', id: context.runId },
        },
      }),
    );
    if (alreadyPresent) {
      return {
        kind: 'succeeded',
        output: { 'list-item-id': id, outcome: 'no_change', 'decision-id': null },
      };
    }
    const staged = await stageListUpdated(tx, deps, environmentId, [
      { listId, changeKind: 'items-added', items: 1 },
    ]);
    const decisionId = adverse
      ? await recordAdverseDecisionInTx(tx, context, {
          subjectType: 'list-item',
          subjectId: id,
          facts,
        })
      : null;
    return {
      kind: 'succeeded',
      output: { 'list-item-id': id, outcome: 'applied', 'decision-id': decisionId },
      staged,
      subjects: [{ subjectId: id, source: 'written' }],
    };
  },
};

/** C127.4: refused with more than one inquiry a run, as bulk biometric adds are (C103). */
async function assertFirstFace(tx: Db, context: ActionContext): Promise<void> {
  const effects = await listWorkflowRunEffects(tx, context.environmentId, context.runId);
  const earlier = effects.some(
    ({ kind, effectKey, status }) =>
      kind === 'add_face_list_item' && effectKey !== context.effectKey && status === 'done',
  );
  if (earlier) {
    throw new ActionStepError('biometric_list_not_bulk');
  }
}

async function faceSource(tx: Db, context: ActionContext, id: string): Promise<Inquiry> {
  const inquiry = await refusing(() => lockedInquiry(tx, context.environmentId, id));
  if (inquiry.redactedAt !== null) {
    throw new ActionStepError('subject_redacted');
  }
  return inquiry;
}

export const ADD_FACE_LIST_ITEM_HANDLER: TransactionActionHandler = {
  key: 'add_face_list_item',
  version: 1,
  shape: 'transaction',
  async onCauseRefused(tx, context) {
    const config = configOf(context, addFaceListItemConfigSchema);
    const facts = await factsFor(tx, context, config['inquiry-id'], config);
    return markInquiryForReviewInTx(tx, context, config['inquiry-id'], facts, 'cause_lacks_scope');
  },
  async execute(tx, context): Promise<ActionResult> {
    const config = configOf(context, addFaceListItemConfigSchema);
    const deps = apiDepsOf(context);
    const { environmentId } = context;
    await assertFirstFace(tx, context);
    const inquiry = await faceSource(tx, context, config['inquiry-id']);
    const list = await refusing(() => requireList(tx, environmentId, config['list-id']));
    await refusing(() => consumeListWrite(deps, environmentId));
    const subjectId = itemIdOf(list.type);
    const facts = await factsFor(tx, context, subjectId, config);
    const adverse = list.purpose === 'block';
    const refusal = adverse
      ? await adverseRefusal(tx, context, {
          facts,
          biometric: await stepIsBiometric(tx, context, inquiry),
          inquiryId: inquiry.id,
          faceList: true,
        })
      : null;
    if (refusal !== null) {
      const followUp = await markInquiryForReviewInTx(tx, context, inquiry.id, facts, refusal);
      return { kind: 'failed', code: refusal, ...followUp };
    }
    const item = await refusing(() =>
      createBiometricListItemInTx(
        tx,
        deps,
        context.acting,
        'face',
        { 'list-id': list.id, 'inquiry-id': inquiry.id },
        subjectId,
      ),
    );
    if (item === null) {
      throw new ActionStepError('object_not_found');
    }
    const decisionId = adverse
      ? await recordAdverseDecisionInTx(tx, context, {
          subjectType: 'list-item',
          subjectId,
          facts,
        })
      : null;
    return {
      kind: 'succeeded',
      output: {
        'list-item-id': subjectId,
        status: item.status,
        outcome: 'applied',
        'decision-id': decisionId,
      },
      afterCommit: () =>
        deps.listItemEmbeds?.enqueueListItemEmbed({ environmentId, itemId: subjectId }) ??
        Promise.resolve(),
      subjects: [
        { subjectId, source: 'written' },
        { subjectId: inquiry.id, source: 'read' },
      ],
    };
  },
};
