import { SUPPORTED_VERIFICATION_TYPES } from '@openverify/contracts';
import type { Db, Verification } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { createRecordingEventPublisher } from '../../test-support/fakes.js';
import { cancelSubResources, SUB_RESOURCE_HOOKS } from './index.js';

describe('the sub-resource cancel hooks (C54.1)', () => {
  it('has one hook per verification type', () => {
    expect(Object.keys(SUB_RESOURCE_HOOKS).sort()).toEqual(
      [...SUPPORTED_VERIFICATION_TYPES].sort(),
    );
  });

  it('does nothing for a type without sub-resources', async () => {
    await expect(
      cancelSubResources({} as Db, createRecordingEventPublisher(), {
        type: 'government_id',
      } as Verification),
    ).resolves.toEqual({ staged: [], storageKeys: [] });
  });
});
