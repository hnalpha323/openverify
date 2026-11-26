/**
 * C122.1: the table the worker runs. A real step reads this table, so an action with no handler here
 * ends `provider_not_configured` in production whatever its own suite says.
 */
import { describe, expect, it } from 'vitest';
import { processActions } from './actions.js';

describe('the process table (C122.1)', () => {
  it('holds a handler for every action the interpreter does not run itself', () => {
    const { registry, handlers } = processActions();

    const missing = registry
      .list()
      .filter(({ kind }) => kind !== 'control')
      .filter(({ key, version }) => handlers.get(key, version) === undefined)
      .map(({ key }) => key);

    expect(missing).toEqual([]);
  });
});
