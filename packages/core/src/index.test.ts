import { describe, expect, it } from 'vitest';
import * as entry from '@openverify/core';
import { PACKAGE_NAME } from './index.js';

describe('@openverify/core entry point', () => {
  it('identifies the package', () => {
    expect(PACKAGE_NAME).toBe('@openverify/core');
  });

  it('resolves the package name to its TypeScript source without a build', () => {
    expect(entry.PACKAGE_NAME).toBe(PACKAGE_NAME);
  });

  it.each([
    'transitionVerification',
    'InvalidVerificationTransitionError',
    'VERIFICATION_EVENT_BY_STATUS',
    'API_SCOPES',
    'PERMISSIONS',
    'BUILTIN_ROLES',
    'permissionsForRoles',
    'isPermission',
    'normalizeTags',
    'addTag',
    'applyAttributeBlocklist',
    'matchesWebhookFilters',
    'idBlurDetectionConfigSchema',
    'selfieIdComparisonConfigSchema',
  ])('re-exports %s', (name) => {
    expect(entry).toHaveProperty(name);
  });
});
