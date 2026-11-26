/**
 * C52.8, C53.7: a business website verification's attributes are the URL as entered, its host
 * (`website-domain`) and the registration date the domain age check read from RDAP
 * (`domain-registered-at`, for the registered domain only). The URL and host are PII: masked for
 * a principal without `pii:view` and `null` once their inputs are redacted; the date, public
 * registry data, is not masked (full redaction clears it with the checks' metadata).
 */
import { BUSINESS_WEBSITE_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import {
  createVerification,
  redactVerificationInputs,
  type VerificationCheck,
  type VerificationWithChecks,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { piiMaskFor } from '../../auth/pii.js';
import { userPrincipal } from '../../test-support/principals.js';
import { businessWebsiteAttributes } from './business-website.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const attributesSchema = z.strictObject(BUSINESS_WEBSITE_VERIFICATION_ATTRIBUTES);
const AT = new Date('2026-10-24T12:00:00.000Z');
const viewer = piiMaskFor(
  userPrincipal({ organizationId: 'org_x', environmentId: 'env_x', permissions: [] }),
);

/** A domain age check as the job stored it. */
const domainAgeCheck = (
  metadata: Record<string, unknown>,
  status: 'passed' | 'failed' | 'not_applicable' = 'passed',
) =>
  ({
    name: 'business_website_domain_age_detection',
    status,
    metadata,
  }) as unknown as VerificationCheck;

async function websiteVerification(
  checks: VerificationCheck[] = [],
  url: string | null = 'https://www.Utopia-Widgets.example/shop?ref=synthetic',
): Promise<VerificationWithChecks> {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'business_website',
  });
  if (url !== null) {
    await seedVerificationInputs(database.db, environment.id, {
      verificationId: verification.id,
      inquiryId: inquiry.id,
      values: { 'website-url': url },
    });
  }
  return { ...verification, checks };
}

describe('the business-website attributes (C52.8)', () => {
  it('are the URL, its host and the registration date the domain age check read', async () => {
    const verification = await websiteVerification([
      domainAgeCheck({ 'registered-at': '2004-05-06', 'age-days': 8207 }),
    ]);

    const loaded = await businessWebsiteAttributes.load(database.db, verification);

    expect(loaded).toEqual({
      'website-url': 'https://www.Utopia-Widgets.example/shop?ref=synthetic',
      'website-domain': 'www.utopia-widgets.example',
      'domain-registered-at': '2004-05-06T00:00:00.000Z',
    });
    expect(attributesSchema.safeParse(loaded).success).toBe(true);
  });

  it('have no registration date when the domain age was unavailable or not checked', async () => {
    const unavailable = await websiteVerification([
      domainAgeCheck({ flags: ['subdomain'] }, 'not_applicable'),
    ]);
    const unchecked = await websiteVerification();

    expect(await businessWebsiteAttributes.load(database.db, unavailable)).toMatchObject({
      'domain-registered-at': null,
    });
    expect(await businessWebsiteAttributes.load(database.db, unchecked)).toMatchObject({
      'domain-registered-at': null,
    });
  });

  it('are every member null before a URL is entered', async () => {
    const verification = await websiteVerification([], null);

    expect(await businessWebsiteAttributes.load(database.db, verification)).toEqual({
      'website-url': null,
      'website-domain': null,
      'domain-registered-at': null,
    });
  });

  it('hide the URL and host from a principal without pii:view, and lose them once redacted', async () => {
    const verification = await websiteVerification([
      domainAgeCheck({ 'registered-at': '2004-05-06' }),
    ]);

    const masked = businessWebsiteAttributes.mask(
      await businessWebsiteAttributes.load(database.db, verification),
      viewer,
    );
    await redactVerificationInputs(database.db, verification.environmentId, [verification.id], AT);
    const redacted = await businessWebsiteAttributes.load(database.db, verification);

    expect(masked).toEqual({
      'website-url': null,
      'website-domain': null,
      'domain-registered-at': '2004-05-06T00:00:00.000Z',
    });
    expect(redacted).toEqual({
      'website-url': null,
      'website-domain': null,
      'domain-registered-at': '2004-05-06T00:00:00.000Z',
    });
  });
});
