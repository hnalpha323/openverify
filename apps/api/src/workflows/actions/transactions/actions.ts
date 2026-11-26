/**
 * C127.7: `create_transaction`, `update_transaction_status`, `set_relation` and `unset_relation`.
 * A status in the type's `adverse-statuses` is adverse: it passes C128's gate, a stopped step leaves
 * its error in a decision record with `needs-review`, and the status stays. The contest route may
 * come from the type's own. `related_objects_limit` and `relation_cardinality_exceeded` stay step
 * errors (outcome 33). A run's relation is recorded by the change's audit entry (outcome 32).
 */
import {
  getTransaction,
  getTransactionType,
  listAccountRelations as listStoredRelations,
  listTransactionRelationsPage,
  type Db,
} from '@openverify/db';
import {
  createTransactionConfigSchema,
  relationConfigSchema,
  updateTransactionStatusConfigSchema,
  type RelationConfig,
  type UpdateTransactionStatusConfig,
} from '@openverify/workflow-engine/actions';
import type { StagedEvent } from '../../../events/index.js';
import {
  accountChangeIn,
  addAccountRelationInTx,
  removeAccountRelationInTx,
} from '../../../services/accounts.js';
import { transactionChangeIn } from '../../../services/transactions/shared.js';
import {
  addTransactionRelationInTx,
  createTransactionInTx,
  removeTransactionRelationInTx,
  updateTransactionInTx,
} from '../../../services/transactions/transactions.js';
import type {
  ActionContext,
  ActionResult,
  TransactionActionHandler,
} from '../../engine/action-port.js';
import { recordCreatedObjectInTx } from '../children.js';
import { runDecisionFactsOf } from '../decisions/facts.js';
import { adverseRefusal } from '../decisions/gate.js';
import { recordAdverseDecisionInTx } from '../decisions/review.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';

export const CREATE_TRANSACTION_HANDLER: TransactionActionHandler = {
  key: 'create_transaction',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const config = configOf(context, createTransactionConfigSchema);
    const deps = apiDepsOf(context);
    const staged: StagedEvent[] = [];
    const transaction = await refusing(() =>
      createTransactionInTx(
        deps,
        transactionChangeIn(tx, deps, context.acting, staged),
        context.acting,
        config as never,
      ),
    );
    await recordCreatedObjectInTx(tx, context, 'transactions', { id: transaction.id });
    return {
      kind: 'succeeded',
      output: {
        'transaction-id': transaction.id,
        status: transaction.status,
        outcome: 'applied',
      },
      staged,
      subjects: [{ subjectId: transaction.id, source: 'written' }],
    };
  },
};

/** The move, gated when adverse. Shared with `update_object`. */
export async function moveTransactionStatusInTx(
  tx: Db,
  context: ActionContext,
  config: Pick<
    UpdateTransactionStatusConfig,
    'transaction-id' | 'status' | 'comment' | 'decision-basis' | 'contest-route' | 'biometric-basis'
  >,
): Promise<ActionResult & { decisionId?: string | null }> {
  const deps = apiDepsOf(context);
  const { environmentId, acting } = context;
  const id = config['transaction-id'];
  const current = await getTransaction(tx, environmentId, id);
  if (current === null) {
    return { kind: 'failed', code: 'object_not_found' };
  }
  if (current.redactedAt !== null) {
    return { kind: 'failed', code: 'subject_redacted' };
  }
  const output = {
    'transaction-id': id,
    status: config.status,
    outcome: 'no_change',
    'decision-id': null,
  };
  if (current.status === config.status) {
    return { kind: 'succeeded', output };
  }
  const type = await getTransactionType(tx, environmentId, current.transactionTypeId);
  const adverse = type?.adverseStatuses.includes(config.status) === true;
  const facts = await runDecisionFactsOf(tx, context, id, {
    ...config,
    'contest-route':
      config['contest-route'] ??
      (type?.contestRoute as Record<string, unknown> | null) ??
      undefined,
  });
  const refusal = adverse
    ? await adverseRefusal(tx, context, { facts, biometric: false, inquiryId: null })
    : null;
  if (refusal !== null) {
    await recordAdverseDecisionInTx(tx, context, {
      subjectType: 'transaction',
      subjectId: id,
      facts,
      needsReview: true,
      errorCode: refusal,
    });
    return { kind: 'failed', code: refusal };
  }
  const staged: StagedEvent[] = [];
  await refusing(() =>
    updateTransactionInTx(deps, transactionChangeIn(tx, deps, acting, staged), acting, id, {
      status: config.status,
    }),
  );
  const decisionId = adverse
    ? await recordAdverseDecisionInTx(tx, context, {
        subjectType: 'transaction',
        subjectId: id,
        facts,
        comment: config.comment,
      })
    : null;
  return {
    kind: 'succeeded',
    output: { ...output, outcome: 'applied', 'decision-id': decisionId },
    staged,
    subjects: [{ subjectId: id, source: 'written' }],
    decisionId,
  };
}

export const UPDATE_TRANSACTION_STATUS_HANDLER: TransactionActionHandler = {
  key: 'update_transaction_status',
  version: 1,
  shape: 'transaction',
  execute: (tx, context) =>
    moveTransactionStatusInTx(tx, context, configOf(context, updateTransactionStatusConfigSchema)),
};

/** Whether the relation already stands, so a repeat is `no_change`. */
async function relationHeld(tx: Db, context: ActionContext, config: RelationConfig) {
  const { environmentId } = context;
  const id = config['object-id'];
  if (config['object-type'] === 'account') {
    const rows = await listStoredRelations(tx, environmentId, id);
    return rows.some(
      ({ relatedAccountId, relationType }) =>
        relatedAccountId === config['target-id'] && relationType === config['relation-key'],
    );
  }
  const page = await listTransactionRelationsPage(tx, environmentId, id, { size: 100 });
  return page.items.some(
    ({ relationSchemaKey, targetId }) =>
      relationSchemaKey === config['relation-key'] && targetId === config['target-id'],
  );
}

function relationHandler(key: 'set_relation' | 'unset_relation'): TransactionActionHandler {
  const setting = key === 'set_relation';
  return {
    key,
    version: 1,
    shape: 'transaction',
    async execute(tx, context) {
      const config = configOf(context, relationConfigSchema);
      const deps = apiDepsOf(context);
      const { acting } = context;
      const id = config['object-id'];
      const output = { 'object-id': id, 'target-id': config['target-id'] };
      if ((await relationHeld(tx, context, config)) === setting) {
        return { kind: 'succeeded', output: { ...output, outcome: 'no_change' } };
      }
      const staged: StagedEvent[] = [];
      await refusing(async () => {
        if (config['object-type'] === 'account') {
          const change = accountChangeIn(tx, deps, acting.ctx, acting.actor, staged);
          const relation = {
            'related-account-id': config['target-id'],
            'relation-type': config['relation-key'],
          };
          await (setting
            ? addAccountRelationInTx(change, id, relation)
            : removeAccountRelationInTx(change, id, relation));
          return;
        }
        const unit = transactionChangeIn(tx, deps, acting, staged);
        const meta = {
          'relation-schema-key': config['relation-key'],
          'target-object-id': config['target-id'],
        };
        await (setting
          ? addTransactionRelationInTx(unit, acting, id, meta)
          : removeTransactionRelationInTx(unit, acting, id, meta));
      });
      return {
        kind: 'succeeded',
        output: { ...output, outcome: 'applied' },
        staged,
        subjects: [
          { subjectId: id, source: 'written' },
          { subjectId: config['target-id'], source: 'read' },
        ],
      };
    },
  };
}

export const SET_RELATION_HANDLER = relationHandler('set_relation');
export const UNSET_RELATION_HANDLER = relationHandler('unset_relation');
