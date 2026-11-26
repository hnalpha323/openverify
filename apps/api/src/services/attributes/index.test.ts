import { SUPPORTED_VERIFICATION_TYPES } from '@openverify/contracts';
import type { Db, VerificationWithChecks } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { piiMaskFor } from '../../auth/pii.js';
import { userPrincipal } from '../../test-support/principals.js';
import {
  attributeHookFor,
  loadVerificationAttributes,
  loadVerificationAttributesOf,
  VERIFICATION_ATTRIBUTE_HOOKS,
} from './index.js';
import { unbuiltAttributeHook } from './stub.js';

const db = {} as Db;
const row = (type: VerificationWithChecks['type'], id = 'ver_x') =>
  ({ id, type }) as VerificationWithChecks;

describe('the attribute hooks (C52.8, C54.1)', () => {
  it('has a hook for every Phase 5 type and none for a government ID or a selfie', () => {
    for (const type of SUPPORTED_VERIFICATION_TYPES) {
      const phase5 = type !== 'government_id' && type !== 'selfie';
      expect(attributeHookFor(type) !== undefined, type).toBe(phase5);
    }
    expect(Object.keys(VERIFICATION_ATTRIBUTE_HOOKS)).toHaveLength(9);
  });

  it('loads nothing for a type without a hook, and gathers the loaded ones by id', async () => {
    await expect(loadVerificationAttributes(db, row('selfie'))).resolves.toBeUndefined();
    const loaded = await loadVerificationAttributesOf(db, [
      row('government_id', 'ver_a'),
      row('selfie', 'ver_b'),
    ]);
    expect([...loaded.keys()]).toEqual([]);
  });
});

describe('unbuiltAttributeHook (C54.1)', () => {
  const hook = unbuiltAttributeHook();

  it('loads no attribute: every C52.8 member is optional', async () => {
    await expect(hook.load(db, row('document'))).resolves.toEqual({});
  });

  it('masks with the C53.7 list', () => {
    const viewer = piiMaskFor(
      userPrincipal({ organizationId: 'org_x', environmentId: 'env_x', permissions: [] }),
    );

    expect(hook.mask({ 'phone-number': '+15555550100', sends: 1 }, viewer)).toEqual({
      'phone-number': null,
      sends: 1,
    });
  });
});
