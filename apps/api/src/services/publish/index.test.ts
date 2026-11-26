import { describe, expect, it } from 'vitest';
import { PUBLISH_HOOKS } from './index.js';
import { noPublishRules } from './stub.js';

describe('the publish hooks (C50.4, C54.1)', () => {
  it('has one hook per Phase 5 type', () => {
    expect(Object.keys(PUBLISH_HOOKS)).toHaveLength(9);
  });

  it('finds no problem until a type adds its rule', async () => {
    await expect(noPublishRules().problems({} as never)).resolves.toEqual([]);
  });
});
