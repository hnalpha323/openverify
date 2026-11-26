/**
 * C127.8: `update_object`: `{ field, operator, value }` on custom fields, tags and each type's
 * documented writable attributes, with the public operators. Archiving an account is adverse (C122.1);
 * a transaction's status goes through the same move as `update_transaction_status`, so its adverse
 * statuses keep their gate. A value a template carried is recorded as a copy on the effect (C120.9).
 */
import { getAccount, type Db } from '@openverify/db';
import {
  updateObjectConfigSchema,
  type UpdateObjectConfig,
} from '@openverify/workflow-engine/actions';
import { isJsonRecord, parseTemplate, type JsonValue } from '@openverify/workflow-engine';
import type { StagedEvent } from '../../../events/index.js';
import { WORKFLOW_OBJECT_TYPES } from '../../definitions/registry.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { runDecisionFactsOf } from '../decisions/facts.js';
import { adverseRefusal } from '../decisions/gate.js';
import { recordAdverseDecisionInTx } from '../decisions/review.js';
import { getCustomFields } from './fields.js';
import { configOf, refusing } from '../shared.js';
import { moveTransactionStatusInTx } from '../transactions/actions.js';
import { rowOf, stateOf, tagRow, updateRow } from './tags.js';
import type { ObjectRow, TagChange, UpdateAttributes } from './table.js';

const noChange = (id: string): ActionResult => ({
  kind: 'succeeded',
  output: { 'object-id': id, outcome: 'no_change', 'decision-id': null },
});

const textOf = (value: JsonValue | undefined): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? null);

function tagChangeOf({ operator, value }: UpdateObjectConfig): TagChange {
  if (operator === 'set' || operator === 'unset') {
    return {
      kind: 'set',
      tags: operator === 'unset' ? [] : Array.isArray(value) ? value.map(textOf) : [textOf(value)],
    };
  }
  return { kind: operator === 'remove' ? 'remove' : 'add', tag: textOf(value) };
}

/** The new value of a list or text member under `operator`, from what it holds. */
function nextValue(operator: UpdateObjectConfig['operator'], held: unknown, value: JsonValue) {
  switch (operator) {
    case 'set':
      return value;
    case 'unset':
      return null;
    case 'append':
      return `${typeof held === 'string' ? held : ''}${textOf(value)}`;
    case 'push':
      return [...(Array.isArray(held) ? (held as JsonValue[]) : []), value];
    default:
      return Array.isArray(held) ? (held as JsonValue[]).filter((item) => item !== value) : held;
  }
}

async function attributesOf(
  tx: Db,
  context: ActionContext,
  config: UpdateObjectConfig,
): Promise<UpdateAttributes> {
  const { field, operator } = config;
  const value = config.value ?? null;
  const entry = WORKFLOW_OBJECT_TYPES.get(config['object-type']);
  if (field !== 'fields' && entry?.writableAttributes.includes(field) === true) {
    return { [field]: nextValue(operator, null, value) };
  }
  if (entry?.writableAttributes.includes('fields') !== true) {
    throw new ActionStepError('action_input_invalid');
  }
  const key = field.startsWith('fields.') ? field.slice('fields.'.length) : field;
  const fields = await getCustomFields(tx, context, config['object-type'], config['object-id']);
  return { fields: { [key]: nextValue(operator, fields[key], value) } };
}

/** C122.1: an account moved to `archived`: adverse, gated, and recorded. */
async function archiveAccount(
  tx: Db,
  context: ActionContext,
  row: ObjectRow,
  config: UpdateObjectConfig,
): Promise<ActionResult> {
  const id = config['object-id'];
  const account = await getAccount(tx, context.environmentId, id);
  if (account?.status === 'archived') {
    return noChange(id);
  }
  const facts = await runDecisionFactsOf(tx, context, id, config);
  const refusal = await adverseRefusal(tx, context, { facts, biometric: false, inquiryId: null });
  if (refusal !== null) {
    await recordAdverseDecisionInTx(tx, context, {
      subjectType: 'account',
      subjectId: id,
      facts,
      needsReview: true,
      errorCode: refusal,
    });
    return { kind: 'failed', code: refusal };
  }
  const staged: StagedEvent[] = [];
  await refusing(async () => updateRow(row, tx, context, id, { status: 'archived' }, staged));
  const decisionId = await recordAdverseDecisionInTx(tx, context, {
    subjectType: 'account',
    subjectId: id,
    facts,
  });
  return {
    kind: 'succeeded',
    output: { 'object-id': id, outcome: 'applied', 'decision-id': decisionId },
    staged,
    subjects: [{ subjectId: id, source: 'written' }],
  };
}

/** C120.9 (P20): a templated value is a PII copy into this object. */
function copyOf(context: ActionContext, id: string) {
  const value = context.step.type === 'action' ? context.step.config.value : undefined;
  const source = isJsonRecord(context.state.trigger) ? context.state.trigger.id : undefined;
  const parsed = value === undefined ? null : parseTemplate(value);
  return parsed?.ok === true && parsed.template.references.length > 0 && typeof source === 'string'
    ? { targetId: id, sourceSubjectIds: [source] }
    : undefined;
}

export const UPDATE_OBJECT_HANDLER: TransactionActionHandler = {
  key: 'update_object',
  version: 1,
  shape: 'transaction',
  async execute(tx, context): Promise<ActionResult> {
    const config = configOf(context, updateObjectConfigSchema);
    const type = config['object-type'];
    const id = config['object-id'];
    const row = rowOf(type);
    await stateOf(tx, context, row, id);
    if (config.field === 'status' && type === 'transaction') {
      const moved = await moveTransactionStatusInTx(tx, context, {
        ...config,
        'transaction-id': id,
        status: textOf(config.value),
      });
      return moved.kind === 'succeeded'
        ? {
            ...moved,
            output: {
              'object-id': id,
              outcome: moved.output.outcome as string,
              'decision-id': moved.decisionId ?? null,
            },
          }
        : moved;
    }
    if (config.field === 'status' && type === 'account' && config.value === 'archived') {
      return archiveAccount(tx, context, row, config);
    }
    const staged: StagedEvent[] = [];
    if (config.field === 'tags') {
      await refusing(async () => tagRow(row, tx, context, id, tagChangeOf(config), staged));
    } else {
      const attributes = await attributesOf(tx, context, config);
      await refusing(async () => updateRow(row, tx, context, id, attributes, staged));
    }
    const copy = copyOf(context, id);
    return {
      kind: 'succeeded',
      output: { 'object-id': id, outcome: 'applied', 'decision-id': null },
      staged,
      ...(copy === undefined ? {} : { copy }),
      subjects: [{ subjectId: id, source: 'written' }],
    };
  },
};
