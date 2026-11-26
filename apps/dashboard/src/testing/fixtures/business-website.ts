/**
 * C61.3–C61.6, C66: business website verifications whose check results carry the metadata the
 * evaluators write (`packages/checks/src/business/business-website-*.ts`): the resolution's
 * `route` and address counts (never an address), the domain age's `registered-at` and `age-days`
 * or its `flags`, the listings' `feed-count`, the backlinks' `backlink-count` and
 * `backlink-threshold`. The scenarios follow the sandbox website names (C61.6). Every host is a
 * reserved name (RFC 2606).
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { Phase5Verification } from '../../components/evidence';
import { phase5Verification } from '../phase5-fixtures';

export type WebsiteScenario =
  'new' | 'old' | 'subdomain' | 'not-resolving' | 'dns' | 'listed' | 'backlinks';

const SANDBOX = { id: 'sandbox', sandbox: true };
const DNS = { id: 'dns', sandbox: false };

const HOSTS: Readonly<Record<WebsiteScenario, string>> = {
  new: 'new.example',
  old: 'old.example',
  subdomain: 'shop.old.example',
  'not-resolving': 'missing-site.invalid',
  dns: 'quillon-lanterns.example',
  listed: 'malicious.example',
  backlinks: 'backlinks.example',
};

/** The day `new.example` was registered: 3 days before the checks ran (`T1`'s day). */
const NEW_DAY = '2026-10-17';
const OLD_DAY = '2006-10-20';

function result(
  name: string,
  status: VerificationCheck['status'],
  reasons: string[],
  metadata: Record<string, unknown>,
  options: {
    readonly required?: boolean;
    readonly provider?: { id: string; sandbox: boolean } | null;
    readonly thresholds?: Record<string, number>;
  } = {},
): VerificationCheck {
  const thresholds = options.thresholds ?? {};
  return {
    name,
    status,
    reasons,
    requirement: options.required === true ? 'required' : 'not_required',
    metadata,
    stage: 'ga',
    confidence: null,
    provenance: {
      'implementation-version': 1,
      ...(options.provider === null || options.provider === undefined
        ? {}
        : { provider: options.provider }),
      thresholds,
      ...(Object.keys(thresholds).length === 0
        ? {}
        : {
            'threshold-basis': Object.fromEntries(
              Object.keys(thresholds).map((key) => [key, 'provisional']),
            ),
          }),
    },
    category: name === 'business_website_resolution_detection' ? 'user_action_required' : 'fraud',
  } as VerificationCheck;
}

const RESOLUTION = 'business_website_resolution_detection';
const AGE = 'business_website_domain_age_detection';
const MALICIOUS = 'business_website_malicious_website_detection';
const BACKLINK = 'business_website_backlink_detection';

const resolves = () => result(RESOLUTION, 'passed', [], { route: 'reserved' }, { required: true });
const ageOf = (day: string, days: number) =>
  result(
    AGE,
    days >= 90 ? 'passed' : 'failed',
    days >= 90 ? [] : ['domain_recently_registered'],
    { 'registered-at': day, 'age-days': days },
    { provider: SANDBOX, thresholds: { 'min-domain-age-days': 90 } },
  );
const ageUnavailable = (flag: string) =>
  result(
    AGE,
    'not_applicable',
    ['domain_age_unavailable'],
    { flags: [flag] },
    { provider: SANDBOX, thresholds: { 'min-domain-age-days': 90 } },
  );

/** The website results as the evaluators write them for `scenario`. */
export function websiteChecks(scenario: WebsiteScenario = 'new'): VerificationCheck[] {
  switch (scenario) {
    case 'new':
      return [resolves(), ageOf(NEW_DAY, 3)];
    case 'old':
      return [resolves(), ageOf(OLD_DAY, 7305)];
    case 'subdomain':
      return [resolves(), ageUnavailable('subdomain')];
    case 'not-resolving':
      return [
        result(
          RESOLUTION,
          'failed',
          ['domain_not_resolving'],
          { route: 'reserved' },
          { required: true },
        ),
        ageUnavailable('not-found'),
      ];
    case 'dns':
      return [
        result(
          RESOLUTION,
          'passed',
          [],
          { route: 'dns', 'address-count': 3, 'public-address-count': 2 },
          { required: true, provider: DNS },
        ),
        ageUnavailable('no-rdap-service'),
      ];
    case 'listed':
      return [
        resolves(),
        ageUnavailable('not-found'),
        result(MALICIOUS, 'failed', ['phishing'], { 'feed-count': 1 }, { provider: SANDBOX }),
      ];
    case 'backlinks':
      return [
        resolves(),
        ageUnavailable('not-found'),
        result(
          BACKLINK,
          'passed',
          [],
          { 'backlink-count': 250, 'backlink-threshold': 10 },
          { provider: SANDBOX, thresholds: { 'min-backlinks': 10 } },
        ),
      ];
  }
}

export interface WebsiteVerificationOptions {
  readonly scenario?: WebsiteScenario;
  readonly masked?: boolean;
  readonly checks?: VerificationCheck[];
  readonly status?: string;
}

/** A business website verification of `scenario`, as the API answers for it. */
export function websiteVerification(options: WebsiteVerificationOptions = {}): Phase5Verification {
  const scenario = options.scenario ?? 'new';
  const host = HOSTS[scenario];
  const day = scenario === 'new' ? NEW_DAY : scenario === 'old' ? OLD_DAY : null;
  return phase5Verification('verification/business-website', {
    masked: options.masked === true,
    attributes: {
      status: options.status ?? (scenario === 'not-resolving' ? 'failed' : 'passed'),
      checks: options.checks ?? websiteChecks(scenario),
      'website-url': `https://${host}/about`,
      'website-domain': host,
      'domain-registered-at': day === null ? null : `${day}T00:00:00.000Z`,
    },
  });
}

/** A redacted business website verification (C16): the URL and host `null`, metadata emptied. */
export function redactedWebsiteVerification(): Phase5Verification {
  return phase5Verification('verification/business-website', {
    masked: true,
    attributes: {
      status: 'passed',
      checks: websiteChecks('new').map((check) => ({ ...check, reasons: [], metadata: {} })),
      'website-url': null,
      'website-domain': null,
      'domain-registered-at': null,
    },
  });
}

/** The URL and host of `scenario`, to search a page or a payload for. */
export function websitePiiValues(scenario: WebsiteScenario = 'new'): string[] {
  return [`https://${HOSTS[scenario]}/about`, HOSTS[scenario]];
}
