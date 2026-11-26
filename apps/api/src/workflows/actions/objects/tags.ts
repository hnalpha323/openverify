/**
 * C127.8: `tag_object`, `remove_tag` and `copy_tags`, through each type's tag service within the
 * 50-tag cap. An object already so is `no_change`. Copying reads the source's tags and adds what the
 * target lacks, at most up to the cap.
 */
import { MAX_TAGS_PER_OBJECT } from '@openverify/core';
import { copyTagsConfigSchema, tagObjectConfigSchema } from '@openverify/workflow-engine/actions';
import type { StagedEvent } from '../../../events/index.js';
import type { ActionContext, TransactionActionHandler } from '../../engine/action-port.js';
import { ActionStepError } from '../../engine/action-port.js';
import { configOf, refusing } from '../shared.js';
import { OBJECT_ROWS, type ObjectRow, type ObjectState, type TagChange } from './table.js';

export function rowOf(type: string): ObjectRow {
  const row = OBJECT_ROWS[type];
  if (row === undefined) {
    throw new ActionStepError('action_input_invalid');
  }
  return row;
}

/** K8-18: a type whose row cannot be tagged fails the step closed, never `applied` with nothing done. */
export async function tagRow(
  row: ObjectRow,
  ...args: Parameters<NonNullable<ObjectRow['tag']>>
): Promise<void> {
  if (row.tag === undefined) {
    throw new ActionStepError('action_input_invalid');
  }
  await row.tag(...args);
}

/** K8-18: the same for a row that cannot be updated. */
export async function updateRow(
  row: ObjectRow,
  ...args: Parameters<NonNullable<ObjectRow['update']>>
): Promise<void> {
  if (row.update === undefined) {
    throw new ActionStepError('action_input_invalid');
  }
  await row.update(...args);
}

export async function stateOf(
  tx: Parameters<ObjectRow['read']>[0],
  context: ActionContext,
  row: ObjectRow,
  id: string,
): Promise<ObjectState> {
  const state = await row.read(tx, context, id);
  if (state === null) {
    throw new ActionStepError('object_not_found');
  }
  if (state.redacted) {
    throw new ActionStepError('subject_redacted');
  }
  return state;
}

function tagHandler(key: 'tag_object' | 'remove_tag'): TransactionActionHandler {
  const adding = key === 'tag_object';
  return {
    key,
    version: 1,
    shape: 'transaction',
    async execute(tx, context) {
      const config = configOf(context, tagObjectConfigSchema);
      const id = config['object-id'];
      const row = rowOf(config['object-type']);
      const { tags } = await stateOf(tx, context, row, id);
      const { tag } = config;
      if (tags.includes(tag) === adding) {
        return {
          kind: 'succeeded',
          output: { 'object-id': id, outcome: 'no_change', 'tag-count': tags.length },
        };
      }
      if (adding && tags.length >= MAX_TAGS_PER_OBJECT) {
        return { kind: 'failed', code: 'tag_limit_exceeded' };
      }
      const staged: StagedEvent[] = [];
      const change: TagChange = { kind: adding ? 'add' : 'remove', tag };
      await refusing(async () => tagRow(row, tx, context, id, change, staged));
      return {
        kind: 'succeeded',
        output: {
          'object-id': id,
          outcome: 'applied',
          'tag-count': tags.length + (adding ? 1 : -1),
        },
        staged,
        subjects: [{ subjectId: id, source: 'written' }],
      };
    },
  };
}

export const TAG_OBJECT_HANDLER = tagHandler('tag_object');
export const REMOVE_TAG_HANDLER = tagHandler('remove_tag');

export const COPY_TAGS_HANDLER: TransactionActionHandler = {
  key: 'copy_tags',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const config = configOf(context, copyTagsConfigSchema);
    const id = config['object-id'];
    const row = rowOf(config['object-type']);
    const source = await stateOf(
      tx,
      context,
      rowOf(config['from-object-type']),
      config['from-object-id'],
    );
    const { tags } = await stateOf(tx, context, row, id);
    const missing = source.tags.filter((tag) => !tags.includes(tag));
    if (missing.length === 0) {
      return {
        kind: 'succeeded',
        output: { 'object-id': id, outcome: 'no_change', 'tag-count': tags.length },
      };
    }
    if (tags.length + missing.length > MAX_TAGS_PER_OBJECT) {
      return { kind: 'failed', code: 'tag_limit_exceeded' };
    }
    const staged: StagedEvent[] = [];
    await refusing(async () =>
      tagRow(row, tx, context, id, { kind: 'set', tags: [...tags, ...missing] }, staged),
    );
    return {
      kind: 'succeeded',
      output: {
        'object-id': id,
        outcome: 'applied',
        'tag-count': tags.length + missing.length,
      },
      staged,
      subjects: [
        { subjectId: id, source: 'written' },
        { subjectId: config['from-object-id'], source: 'read' },
      ],
    };
  },
};
