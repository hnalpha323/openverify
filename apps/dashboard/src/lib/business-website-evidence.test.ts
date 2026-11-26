/**
 * C61.3–C61.5, C66: what the business website evidence reads from a verification answer: the
 * resolution and its route and counts, the registration day and age against the minimum, the
 * listings and the backlinks, each with its provider.
 */
import { describe, expect, it } from 'vitest';
import {
  websiteChecks,
  websiteVerification,
  type WebsiteScenario,
} from '../testing/fixtures/business-website';
import { phase5Verification } from '../testing/phase5-fixtures';
import {
  businessWebsiteEvidenceOf,
  type BusinessWebsiteVerification,
} from './business-website-evidence';

const evidenceOf = (scenario: WebsiteScenario) =>
  businessWebsiteEvidenceOf(websiteVerification({ scenario }) as BusinessWebsiteVerification);

describe('businessWebsiteEvidenceOf (C61.3–C61.5)', () => {
  it('reads a reserved name’s resolution, and a recent domain’s age against the minimum', () => {
    expect(evidenceOf('new')).toMatchObject({
      ran: true,
      resolution: {
        outcome: {
          name: 'business_website_resolution_detection',
          status: 'passed',
          required: true,
        },
        route: 'reserved',
        addresses: null,
        publicAddresses: null,
        provider: null,
      },
      domainAge: {
        outcome: { status: 'failed', required: false, reasons: ['domain_recently_registered'] },
        registeredAt: '2026-10-17',
        ageDays: 3,
        minimumDays: 90,
        flags: [],
        provider: { id: 'sandbox', sandbox: true },
      },
      listings: { outcome: null, feeds: null },
      backlinks: { outcome: null, count: null },
    });
  });

  it('reads a DNS resolution’s address counts, never an address', () => {
    expect(evidenceOf('dns').resolution).toMatchObject({
      route: 'dns',
      addresses: 3,
      publicAddresses: 2,
      provider: { id: 'dns', sandbox: false },
    });
  });

  it('reads why an age is unavailable', () => {
    expect(evidenceOf('subdomain').domainAge).toMatchObject({
      outcome: { status: 'not_applicable', reasons: ['domain_age_unavailable'] },
      ageDays: null,
      flags: ['subdomain'],
    });
  });

  it('reads the listings and the backlinks', () => {
    expect(evidenceOf('listed').listings).toMatchObject({
      outcome: { status: 'failed', reasons: ['phishing'] },
      feeds: 1,
      provider: { id: 'sandbox', sandbox: true },
    });
    expect(evidenceOf('backlinks').backlinks).toMatchObject({
      outcome: { status: 'passed' },
      count: 250,
      threshold: 10,
    });
  });

  it('reads the minimum from the threshold when the result records no age', () => {
    const [, age] = websiteChecks('subdomain');
    expect(age?.provenance?.thresholds['min-domain-age-days']).toBe(90);
    expect(evidenceOf('subdomain').domainAge.minimumDays).toBe(90);
  });

  it('reads nothing before the checks ran', () => {
    expect(
      businessWebsiteEvidenceOf(
        websiteVerification({ checks: [], status: 'initiated' }) as BusinessWebsiteVerification,
      ),
    ).toMatchObject({
      ran: false,
      resolution: { outcome: null, route: null },
      domainAge: { outcome: null, registeredAt: null, minimumDays: null },
    });
  });

  it('reads the golden fixture, which the evaluators wrote', () => {
    expect(
      businessWebsiteEvidenceOf(
        phase5Verification('verification/business-website') as BusinessWebsiteVerification,
      ),
    ).toMatchObject({
      resolution: { route: 'reserved' },
      domainAge: { registeredAt: '2026-10-17', ageDays: 3, minimumDays: 90 },
    });
  });
});
