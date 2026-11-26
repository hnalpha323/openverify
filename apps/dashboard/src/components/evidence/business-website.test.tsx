/**
 * C61.3–C61.5, C66: the business website evidence on its card and page: what a pass means; the
 * URL and host; the resolution and how it was read; the domain's registration date and age against
 * the minimum, as an advisory result; the malicious-website listings and the backlinks, each with
 * its provider labelled sandbox. The URL and host come from the verification answer alone,
 * "Hidden" without `pii:view`, "Redacted" after a redaction (C53.7).
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerificationPage from '../../app/verifications/[id]/page';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  redactedWebsiteVerification,
  websiteChecks,
  websitePiiValues,
  websiteVerification,
} from '../../testing/fixtures/business-website';
import { phase5Verification } from '../../testing/phase5-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { RECORDS_VIEWER, serveRecordsVerification } from '../../testing/routes/records';
import { BusinessWebsiteEvidence } from './business-website';
import type { EvidenceProps } from './generic';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const LABEL = 'Business website';

function show(
  verification: EvidenceProps['verification'] = websiteVerification(),
  state: EvidenceProps['state'] = 'visible',
) {
  return render(
    <BusinessWebsiteEvidence verification={verification} label={LABEL} state={state} />,
  );
}

const group = () => screen.getByRole('group', { name: `${LABEL} evidence` });

function term(name: string): HTMLElement {
  const dd = within(group()).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${name}`);
  return dd;
}

describe('BusinessWebsiteEvidence (C61, C66)', () => {
  it('is a group named after the verification, saying what a pass means and what it does not', () => {
    show();

    expect(group()).toHaveTextContent(/What a pass means/);
    expect(group()).toHaveTextContent(/who runs the site/);
  });

  it('shows the URL and host the user entered', () => {
    show();

    expect(term('Website address')).toHaveTextContent(/^https:\/\/new\.example\/about$/);
    expect(term('Domain')).toHaveTextContent(/^new\.example$/);
  });

  it('shows a reserved name resolved by the sandbox rule, with no DNS query', () => {
    show();

    const resolution = term('Resolution');
    expect(resolution).toHaveTextContent(/Passed.*Required/);
    expect(resolution).toHaveTextContent('Reserved name, sandbox rule');
    expect(resolution).toHaveTextContent(/without a DNS query/);
  });

  it('shows a DNS resolution as counts, and its resolver as no sandbox', () => {
    show(websiteVerification({ scenario: 'dns' }));

    const resolution = term('Resolution');
    expect(resolution).toHaveTextContent('DNS A and AAAA records');
    expect(resolution).toHaveTextContent('3 addresses, 2 public');
    expect(resolution).not.toHaveTextContent('Sandbox');
  });

  it('shows a host that does not resolve as a failure the user can correct', () => {
    show(websiteVerification({ scenario: 'not-resolving' }));

    expect(term('Resolution')).toHaveTextContent(/Failed.*Required.*Domain does not resolve/);
  });

  it('shows the registration day, and a recent domain’s age as an advisory failure against the minimum', () => {
    show();

    expect(term('Registered on')).toHaveTextContent(/^2026-10-17$/);
    const age = term('Domain age');
    expect(age).toHaveTextContent(/Failed.*Advisory.*Domain registered recently/);
    expect(age).toHaveTextContent('3 days old; the minimum is 90 days');
    expect(age).toHaveTextContent('Sandbox provider');
  });

  it('shows an old domain’s age as passed', () => {
    show(websiteVerification({ scenario: 'old' }));

    expect(term('Domain age')).toHaveTextContent(/Passed.*Advisory/);
    expect(term('Domain age')).toHaveTextContent('7305 days old; the minimum is 90 days');
  });

  it('says why a subdomain is not aged, and that no registration day is available', () => {
    show(websiteVerification({ scenario: 'subdomain' }));

    const age = term('Domain age');
    expect(age).toHaveTextContent(/Not applicable.*Advisory.*Domain age unavailable/);
    expect(within(age).getByRole('list', { name: 'Domain age flags' })).toHaveTextContent(
      'A platform’s subdomain',
    );
    expect(age).toHaveTextContent('The minimum is 90 days');
    expect(term('Registered on')).toHaveTextContent('Not available');
  });

  it('says the listings and backlinks were not checked when the template does not run them', () => {
    show();

    expect(term('Malicious-website listings')).toHaveTextContent(
      'Not checked: the template does not run this check',
    );
    expect(term('Backlinks')).toHaveTextContent(
      'Not checked: the template does not run this check',
    );
  });

  it('shows a listing, with the feeds checked and the sandbox feed', () => {
    show(websiteVerification({ scenario: 'listed' }));

    const listings = term('Malicious-website listings');
    expect(listings).toHaveTextContent(/Failed.*Advisory.*Listed for phishing/);
    expect(listings).toHaveTextContent('Checked against 1 feed');
    expect(listings).toHaveTextContent('Sandbox provider');
  });

  it('shows the backlinks against the minimum', () => {
    show(websiteVerification({ scenario: 'backlinks' }));

    expect(term('Backlinks')).toHaveTextContent(/Passed.*Advisory/);
    expect(term('Backlinks')).toHaveTextContent('250 backlinks; the minimum is 10');
  });

  it('says nothing was checked before the checks ran', () => {
    show(websiteVerification({ checks: [], status: 'initiated', scenario: 'subdomain' }));

    expect(term('Resolution')).toHaveTextContent('No result yet');
    expect(term('Domain age')).toHaveTextContent('No result yet');
    expect(term('Registered on')).toHaveTextContent('Not recorded yet');
    expect(term('Malicious-website listings')).toHaveTextContent('No result yet');
  });

  it('shows the URL and host the API masked as "Hidden", and the public registration day it did not', () => {
    show(websiteVerification({ masked: true }), 'hidden');

    expect(within(term('Website address')).getByText('Hidden')).toHaveAccessibleDescription(
      'Your role cannot see personal data (the pii:view permission).',
    );
    expect(term('Domain')).toHaveTextContent('Hidden');
    expect(term('Registered on')).toHaveTextContent('2026-10-17');
    for (const value of websitePiiValues()) {
      expect(group()).not.toHaveTextContent(value);
    }
  });

  it('shows "Redacted" for what a redaction removed', () => {
    show(redactedWebsiteVerification(), 'redacted');

    expect(term('Website address')).toHaveTextContent(/^Redacted$/);
    expect(term('Registered on')).toHaveTextContent(/^Redacted$/);
    expect(term('Domain age')).toHaveTextContent('Redacted');
  });

  it('shows another type’s verification through the generic view', () => {
    render(
      <BusinessWebsiteEvidence
        verification={phase5Verification('verification/database')}
        label={LABEL}
        state="visible"
      />,
    );

    expect(screen.getByText('Name first', { selector: 'dt' })).toBeVisible();
  });
});

describe('BusinessWebsiteEvidence with what the console has no words for, or less recorded (C66)', () => {
  it('shows a route, flag or reason it does not know as its code', () => {
    const checks = [
      {
        ...websiteChecks('dns')[0],
        name: 'business_website_resolution_detection' as const,
        status: 'not_applicable' as const,
        reasons: ['a_future_reason'],
        requirement: 'required' as const,
        metadata: { route: 'a-future-route' },
      },
      {
        ...websiteChecks('subdomain')[1],
        name: 'business_website_domain_age_detection' as const,
        status: 'not_applicable' as const,
        reasons: ['domain_age_unavailable'],
        requirement: 'not_required' as const,
        metadata: { flags: ['a-future-flag'] },
      },
    ];
    show(websiteVerification({ checks }));

    expect(term('Resolution')).toHaveTextContent('a_future_reason');
    expect(term('Resolution')).toHaveTextContent('a-future-route');
    expect(term('Domain age')).toHaveTextContent('a-future-flag');
  });

  it('says one day, one address and one feed in the singular, and an age or count without its threshold', () => {
    const checks = websiteChecks('listed').map((check) => {
      switch (check.name) {
        case 'business_website_resolution_detection':
          return {
            ...check,
            metadata: { route: 'dns', 'address-count': 1, 'public-address-count': 1 },
          };
        case 'business_website_domain_age_detection':
          return {
            ...check,
            status: 'failed' as const,
            reasons: ['domain_recently_registered'],
            metadata: { 'registered-at': '2026-10-19', 'age-days': 1 },
            provenance: { 'implementation-version': 1, thresholds: {} },
          };
        default:
          return check;
      }
    });
    const backlinks = {
      ...websiteChecks('backlinks')[2],
      name: 'business_website_backlink_detection' as const,
      status: 'failed' as const,
      reasons: ['backlinks_below_threshold'],
      requirement: 'not_required' as const,
      metadata: { 'backlink-count': 1 },
    };
    show(websiteVerification({ checks: [...checks, backlinks] }));

    expect(term('Resolution')).toHaveTextContent('1 address, 1 public');
    expect(term('Domain age')).toHaveTextContent(/1 day old$/);
    expect(term('Malicious-website listings')).toHaveTextContent('Checked against 1 feed');
    expect(term('Backlinks')).toHaveTextContent(/1 backlink$/);
  });

  it('shows "Redacted" for the listing and backlink details a redaction removed', () => {
    const checks = [...websiteChecks('listed'), ...websiteChecks('backlinks').slice(2)].map(
      (check) => ({ ...check, reasons: [], metadata: {} }),
    );
    show(websiteVerification({ checks, masked: true }), 'redacted');

    expect(term('Malicious-website listings')).toHaveTextContent('Redacted');
    expect(term('Backlinks')).toHaveTextContent('Redacted');
  });
});

describe('the business website evidence on its page (C26, C53.7, C66)', () => {
  let api: RouteApi;

  beforeEach(() => {
    fakeRequest.reset();
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api = routeApi();
  });

  afterEach(() => {
    api.restore();
  });

  const page = (id: string) => VerificationPage({ params: Promise.resolve({ id }) });

  it('lets no value the API masked reach the page or the RSC payload from another source', async () => {
    serveRecordsVerification(api, websiteVerification({ masked: true }), {
      seen: websiteVerification(),
      permissions: RECORDS_VIEWER,
    });

    const element = await page(websiteVerification().id);
    const payload = await rscPayloadOf(element);
    render(element);

    expect(screen.getByRole('group', { name: `${LABEL} evidence` })).toHaveTextContent('Hidden');
    for (const value of websitePiiValues()) {
      expect(document.body.textContent).not.toContain(value);
      expect(payload).not.toContain(value);
    }
  });

  it('puts the values in the payload for an operator the API shows them to (the check above can fail)', async () => {
    serveRecordsVerification(api, websiteVerification());

    const payload = await rscPayloadOf(await page(websiteVerification().id));

    for (const value of websitePiiValues()) {
      expect(payload).toContain(value);
    }
  });
});
