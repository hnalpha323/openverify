/**
 * C61.2 (P08), C53.5: the KYB path keeps no personal data in Valkey. Business registry and website
 * verifications are judged end to end, through `processVerification`, by the sandbox providers and
 * by the real clients (Companies House, GLEIF, RDAP and the feed list, over `MockAgent` with
 * synthetic answers that name the sandbox officer and PSC), every one of them writing to one
 * in-memory cache; then every key and every value the path wrote (query cache, pacing slots, the
 * RDAP bootstrap and dates, the feeds) is scanned for the officers' and the entered persons' names
 * and birth months, the entered business, and the website's path and query. Only ids, hashes,
 * hosts of public feeds, public dates and counts may be there.
 */
import { newId } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import {
  createVerification,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  type TestDatabase,
} from '@openverify/db/testing';
import { flowSchema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../../events/index.js';
import { systemClock, type BoundProviders } from '../../ports.js';
import { createBacklinkProvider } from '../../providers/backlink/index.js';
import { COMPANIES_HOUSE_BASE_URLS } from '../../providers/business-registry/companies-house.js';
import {
  createBusinessRegistryProviders,
  createSandboxBusinessRegistryProvider,
} from '../../providers/business-registry/index.js';
import { SANDBOX_REGISTRY_PERSONS } from '../../providers/business-registry/sandbox.js';
import {
  createMockOutbound,
  jsonHeaders,
  type MockOutbound,
} from '../../providers/business-registry/testing.js';
import { createDomainAgeProvider } from '../../providers/domain-age/index.js';
import { createMaliciousWebsiteProvider } from '../../providers/malicious-website/index.js';
import { createFakeDnsResolver, createInMemoryKeyValueCache } from '../../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { refreshMaliciousFeeds } from '../repeatable/feeds.js';
import { processVerification, type ProcessVerificationDeps } from '../process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from '../testing.js';

/** The real clock: the pacing waits for real slots, so a frozen clock would never move on. */
const clock = systemClock;
const KEY = 'synthetic-companies-house-key-0003';
const FEEDS = {
  schema_version: 1 as const,
  feeds: [
    {
      id: 'synthetic-phishing',
      url: 'https://feeds.example.test/synthetic-phishing.txt',
      format: 'urls' as const,
      category: 'phishing' as const,
      refresh_interval_seconds: 3600,
      terms: 'Synthetic test feed.',
    },
  ],
};

const FLOW = flowSchema.parse({
  metadata: { specVersion: 1, id: 'kyb-scan', version: 1, name: 'KYB' },
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    { id: 'business', type: 'database_business', collectAssociatedPersons: true },
    { id: 'website', type: 'business_website' },
    { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
  ],
  transitions: [],
});

const PERSON = { 'name-first': 'Ada', 'name-last': 'Placeholder', birthdate: '1980-04' };
const BUSINESS = {
  'business-name': 'Quillfeather Synthetic Bakery Ltd',
  'country-code': 'GB',
  'address-street-1': '7 Marrowstone Mews',
  'address-city': 'Utopia Town',
  'address-postal-code': 'UT7 7ZZ',
  'associated-persons': [PERSON],
};
const WEBSITE = {
  'website-url': 'https://www.utopia-bakery.example/contact?owner=ada.placeholder%40example.test',
};

/** Text that must never reach Valkey. */
const PERSONAL = [
  ...SANDBOX_REGISTRY_PERSONS.map((person) => person.name),
  'PLACEHOLDER',
  'Placeholder',
  'Testerton',
  '1980-04',
  '1975-09',
  'Quillfeather',
  'Marrowstone',
  'ada.placeholder',
  '/contact',
  'owner=',
];

const WEBSITE_ALL: Record<string, { enabled: boolean; required: boolean }> = {
  business_website_resolution_detection: { enabled: true, required: true },
  business_website_domain_age_detection: { enabled: true, required: false },
  business_website_malicious_website_detection: { enabled: true, required: false },
  business_website_backlink_detection: { enabled: true, required: false },
};

let database: TestDatabase;
let db: Db;
let outbound: MockOutbound;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  outbound = createMockOutbound();
}, 60_000);

afterAll(async () => {
  await outbound.close();
  await database.close();
});

/** Submitted business and website verifications of a pending inquiry in `environmentId`. */
async function submittedPair(environmentId: string, business: Record<string, unknown>) {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: FLOW,
    verificationConfig: {
      'database-business': defaultTemplateConfig('database_business'),
      'business-website': { checks: WEBSITE_ALL },
    },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const ids: string[] = [];
  for (const [type, values] of [
    ['database_business', business],
    ['business_website', WEBSITE],
  ] as const) {
    const id = newId('ver');
    await createVerification(db, environmentId, { id, inquiryId: inquiry.id, type });
    await seedVerificationInputs(db, environmentId, {
      verificationId: id,
      inquiryId: inquiry.id,
      values,
    });
    await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
    ids.push(id);
  }
  return ids;
}

function deps(
  cache: ReturnType<typeof createInMemoryKeyValueCache>,
  providers: { sandbox?: BoundProviders; production?: BoundProviders },
): ProcessVerificationDeps {
  const logger = createCapturingLogger();
  return {
    db,
    storage: createMemoryStorage(),
    keyring: database.keyring,
    vision: createFakeVision().client,
    events: createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
      logger,
    }),
    clock,
    logger,
    cache,
    providers: { sandbox: providers.sandbox ?? {}, production: providers.production ?? {} },
    dnsResolver: createFakeDnsResolver({
      'www.utopia-bakery.example': { a: ['203.0.114.9'] },
    }),
  };
}

/** Every key the path wrote and every value under it, as one text. */
async function everything(cache: ReturnType<typeof createInMemoryKeyValueCache>) {
  const parts: string[] = [];
  for (const key of cache.keys()) {
    parts.push(key, (await cache.get(key)) ?? '', ...(await cache.listRange(key, 1000)));
  }
  return parts.join('\n');
}

/** The synthetic answers of Companies House, GLEIF, RDAP and the feed. */
function answerTheRealSources() {
  const house = outbound.agent.get(COMPANIES_HOUSE_BASE_URLS.production);
  house
    .intercept({ path: (path) => path.startsWith('/search/companies?'), method: 'GET' })
    .reply(
      200,
      { items: [{ company_number: '07777777', title: 'QUILLFEATHER SYNTHETIC BAKERY LIMITED' }] },
      jsonHeaders(),
    );
  house.intercept({ path: '/company/07777777', method: 'GET' }).reply(
    200,
    {
      company_name: 'QUILLFEATHER SYNTHETIC BAKERY LIMITED',
      company_number: '07777777',
      company_status: 'active',
      jurisdiction: 'england-wales',
      registered_office_address: {
        address_line_1: '7 Marrowstone Mews',
        locality: 'Utopia Town',
        postal_code: 'UT7 7ZZ',
      },
    },
    jsonHeaders(),
  );
  house.intercept({ path: (path) => path.includes('/officers?'), method: 'GET' }).reply(
    200,
    {
      items: [
        {
          name: 'PLACEHOLDER, Ada',
          officer_role: 'director',
          date_of_birth: { month: 4, year: 1980 },
        },
      ],
    },
    jsonHeaders(),
  );
  house
    .intercept({
      path: (path) => path.includes('/persons-with-significant-control?'),
      method: 'GET',
    })
    .reply(
      200,
      {
        items: [
          {
            name: 'Mr Robin Testerton',
            kind: 'individual-person-with-significant-control',
            date_of_birth: { month: 9, year: 1975 },
          },
        ],
      },
      jsonHeaders(),
    );
  outbound.agent
    .get('https://data.iana.org')
    .intercept({ path: '/rdap/dns.json', method: 'GET' })
    .reply(
      200,
      { services: [[['example'], ['https://rdap.registry-one.example.test/']]] },
      jsonHeaders(),
    );
  const registry = outbound.agent.get('https://rdap.registry-one.example.test');
  registry.intercept({ path: '/domain/www.utopia-bakery.example', method: 'GET' }).reply(404, '');
  registry.intercept({ path: '/domain/utopia-bakery.example', method: 'GET' }).reply(
    200,
    {
      objectClassName: 'domain',
      ldhName: 'utopia-bakery.example',
      events: [{ eventAction: 'registration', eventDate: '2004-05-06T07:08:09Z' }],
    },
    jsonHeaders('application/rdap+json'),
  );
  outbound.agent
    .get('https://feeds.example.test')
    .intercept({ path: '/synthetic-phishing.txt', method: 'GET' })
    .reply(200, 'https://login.phish.example/steal?victim=someone%40example.test\n', {
      headers: { 'content-type': 'text/plain' },
    });
}

describe('the KYB path keeps no personal data in Valkey (C61.2, P08)', () => {
  it('with the sandbox providers', async () => {
    const cache = createInMemoryKeyValueCache(clock);
    const environmentId = (await createTestTenant(db)).environment.id;
    const ids = await submittedPair(environmentId, BUSINESS);
    const sandbox: BoundProviders = {
      businessRegistry: createSandboxBusinessRegistryProvider(),
      domainAge: createDomainAgeProvider('sandbox', { clock }),
      maliciousWebsite: createMaliciousWebsiteProvider('sandbox'),
      backlink: createBacklinkProvider('sandbox'),
    };

    for (const verificationId of ids) {
      await processVerification({ environmentId, verificationId }, deps(cache, { sandbox }));
    }

    const text = await everything(cache);
    for (const value of PERSONAL) {
      expect(text).not.toContain(value);
    }
  });

  it('with Companies House, GLEIF, RDAP and the feed list, whose answers name the officers', async () => {
    answerTheRealSources();
    const cache = createInMemoryKeyValueCache(clock);
    const environmentId = (await createTestTenant(db, { kind: 'production' })).environment.id;
    const ids = await submittedPair(environmentId, BUSINESS);
    await refreshMaliciousFeeds({
      db,
      clock,
      logger: createCapturingLogger(),
      cache,
      outboundHttp: outbound,
      maliciousFeeds: FEEDS,
    });
    const production: BoundProviders = {
      businessRegistry: createBusinessRegistryProviders(['gleif', 'companies-house'], {
        environment: 'production',
        companiesHouse: { apiKey: KEY, sandboxApiKey: null },
        outboundHttp: outbound,
        cache,
        clock,
      }),
      domainAge: createDomainAgeProvider('rdap', { outboundHttp: outbound, cache, clock }),
      maliciousWebsite: createMaliciousWebsiteProvider('feed-list', {
        feeds: FEEDS,
        cache,
        clock,
      }),
    };

    for (const verificationId of ids) {
      const result = await processVerification(
        { environmentId, verificationId },
        deps(cache, { production }),
      );
      expect(result).toMatchObject({ outcome: 'processed' });
    }

    const text = await everything(cache);
    expect(cache.keys().some((key) => key.startsWith('openverify:kyb-registry:'))).toBe(true);
    expect(cache.keys().some((key) => key.startsWith('openverify:rdap:date:'))).toBe(true);
    expect(cache.keys().some((key) => key.startsWith('openverify:malicious-feed:'))).toBe(true);
    expect(text).not.toContain(KEY);
    for (const value of [...PERSONAL, 'victim=', 'someone']) {
      expect(text).not.toContain(value);
    }
  });
});
