import { describe, expect, it } from 'vitest';
import * as entry from '@openverify/db';
import * as testingEntry from '@openverify/db/testing';
import { PACKAGE_NAME } from './index.js';
import { createTestDatabase } from './testing.js';

describe('@openverify/db entry point', () => {
  it('identifies the package', () => {
    expect(PACKAGE_NAME).toBe('@openverify/db');
  });

  it('resolves the package name to its TypeScript source without a build', () => {
    expect(entry.PACKAGE_NAME).toBe(PACKAGE_NAME);
  });

  it('exports the repositories, token hashing and pagination errors', () => {
    for (const name of [
      'createOrganization',
      'findApiKeyBySecretHash',
      'touchApiKeyLastUsed',
      'createUserSession',
      'findActiveUserSessionByTokenHash',
      'createInquiryTemplate',
      'createInquiry',
      'listInquiries',
      'transitionInquiryStatus',
      'findActiveInquirySessionByTokenHash',
      'recordInquirySessionConsent',
      'replaceVerificationChecks',
      'createFile',
      'createEvent',
      'listWebhooksForEvent',
      'listDueWebhookDeliveries',
      'recordWebhookDeliveryAttempt',
      'appendAuditLog',
      'hashSessionToken',
      'InvalidCursorError',
      'encryptBytes',
      'decryptBytes',
    ]) {
      expect(entry, name).toHaveProperty(name, expect.any(Function));
    }
  });

  it('exposes the PGlite helpers as @openverify/db/testing, separate from the main entry', () => {
    expect(testingEntry.createTestDatabase).toBe(createTestDatabase);
    expect(entry).not.toHaveProperty('createTestDatabase');
  });
});
