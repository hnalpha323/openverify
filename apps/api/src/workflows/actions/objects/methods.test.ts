/**
 * Workflow 8C review K8-18 (plan item 108): a row of the object-type table that lacks `tag` or
 * `update` fails the step closed with an action error, and never answers `applied` with nothing done.
 * A probe row stands in for such a type, because every published type that lacks one is refused
 * earlier, by its grant or its writable attributes.
 */
import type { Db } from '@openverify/db';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionContext } from '../../engine/action-port.js';
import { OBJECT_ROWS, type ObjectRow } from './table.js';
import { TAG_OBJECT_HANDLER } from './tags.js';
import { UPDATE_OBJECT_HANDLER } from './update.js';

const rows = OBJECT_ROWS as Record<string, ObjectRow>;

const probe: ObjectRow = {
  read: () => Promise.resolve({ tags: [], redacted: false }),
  fetch: () => Promise.resolve({}),
};

afterEach(() => {
  delete rows.probe;
});

const contextOf = (config: Record<string, unknown>) =>
  ({
    environmentId: 'env_synthetic',
    config,
    step: { type: 'action', config },
    state: { trigger: null },
  }) as unknown as ActionContext;

describe('a type without the method (K8-18)', () => {
  it('refuses tag_object', async () => {
    rows.probe = probe;
    await expect(
      TAG_OBJECT_HANDLER.execute(
        {} as Db,
        contextOf({ 'object-type': 'probe', 'object-id': 'prb_1', tag: 'synthetic' }),
      ),
    ).rejects.toMatchObject({ code: 'action_input_invalid' });
  });

  it('refuses update_object on its tags', async () => {
    rows.probe = probe;
    await expect(
      UPDATE_OBJECT_HANDLER.execute(
        {} as Db,
        contextOf({
          'object-type': 'probe',
          'object-id': 'prb_1',
          field: 'tags',
          operator: 'push',
          value: 'synthetic',
        }),
      ),
    ).rejects.toMatchObject({ code: 'action_input_invalid' });
  });
});
