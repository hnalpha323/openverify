/**
 * C90-C94 (Workflow 7A): signals, full stack. Budget: 90 s.
 *
 * An inquiry on a template whose consent step shows `notice.session-integrity` (the default's, so
 * session integrity collects) and whose `signal-config` sends a Tor session to review
 * (`on-signal: needs_review`, a rule on `inquiry/tor_detected`). Two sessions reach the API through
 * the stack's trusted loopback proxy (F34) from the sandbox addresses of C93.6:
 * - session A from `192.0.2.20`, the fictional provider range: `is-datacenter` true;
 * - session B from `192.0.2.10`, a Tor exit, which consents and completes the database step in
 *   Chromium, whose collector (C94.3) posts its screens: Playwright's Chromium reports
 *   `navigator.webdriver`, a strong automation artefact.
 * Once the inquiry completes, the `inquiry-signals` job freezes the signals from both sessions
 * (C90.4: Tor and datacenter from different sessions, the threat level `high`), `bot_score` reaches
 * the strong band from the collector's bodies, and the rule moves the inquiry to `needs_review`
 * with the cause recorded (C90.7). The sessions serve their network facts with provenance and the
 * trust mode. The flow API's CORS list is unchanged by the header the specs add.
 * Every address is from the documentation ranges; nothing calls a publisher.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_DATABASE_CHECKS } from '@openverify/contracts';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import { flowCorsAllowedHeaders, presentAddress } from './support/network.js';
import { phase5Template, typeConfig } from './support/phase5.js';
import { recordingClient } from './support/platform.js';

type Steps = Parameters<typeof phase5Template>[1];

const DATABASE_STEPS: Steps = [
  {
    id: 'records',
    type: 'database',
    fields: [
      'name_first',
      'name_last',
      'birthdate',
      'address_street_1',
      'address_city',
      'address_postal_code',
      'address_country_code',
    ],
  },
];

const TOR_EXIT = '192.0.2.10';
const PROVIDER_RANGE = '192.0.2.20';

/** A page in its own context whose API requests come from `address` (through the trusted proxy). */
async function pageFrom(browser: Browser, apiUrl: string, address: string): Promise<Page> {
  const context = await browser.newContext();
  await presentAddress(context, apiUrl, address);
  return context.newPage();
}

/** The fictional person of the database spec, entered in the hosted flow's form. */
async function enterDatabaseRecord(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Enter your details' })).toBeVisible();
  await page.getByRole('textbox', { name: 'First name' }).fill('Bob');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Quillon');
  await page.getByLabel('Date of birth', { exact: true }).fill('1984-07-09');
  const address = page.getByRole('group', { name: 'Address' });
  await address.getByRole('textbox', { name: 'Address line 1' }).fill('12 Example Street');
  await address.getByRole('textbox', { name: 'Town or city' }).fill('Exampleton');
  await address.getByRole('textbox', { name: 'Postal code' }).fill('00000');
  await address.getByRole('combobox', { name: 'Country' }).selectOption('US');
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('the sessions’ network facts and the collector feed the inquiry signals, and the on-signal rule sends a Tor session to review (C90, C91, C93, C94)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID();

  // F34: the header the specs add is below CORS: the production preflight list does not hold it.
  // C151.7 (Workflow 9A): the flow declares the flow-spec versions it renders.
  expect(await flowCorsAllowedHeaders(stack.apiUrl, stack.flowUrl)).toEqual([
    'authorization',
    'content-type',
    'x-request-id',
    'openverify-flow-spec',
  ]);

  const attributes = phase5Template(`e2e-signals-${run}`, DATABASE_STEPS, {
    database: typeConfig(DEFAULT_DATABASE_CHECKS),
  });
  const consent = attributes.flow.steps.find((step) => step.type === 'consent');
  expect(consent?.type === 'consent' ? consent.textKeys : []).toContain('notice.session-integrity');
  const { data: template } = await client.inquiryTemplates.create(attributes);
  const { data: draft } = await client.inquiryTemplateVersions.create({
    'inquiry-template-id': template.id,
    flow: attributes.flow,
    'verification-config': attributes['verification-config'],
    'signal-config': {
      collect: 'default',
      'on-signal': 'needs_review',
      'review-rules': [{ signal: 'inquiry/tor_detected', eq: true }],
    },
  });
  await client.inquiryTemplateVersions.publish(draft.id);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': template.id,
    'reference-id': `e2e-signals-${run} sandbox-database-nickname`,
  });

  // Session A, from the provider range: it opens the flow, which starts and evaluates it (C93.2).
  const first = await client.inquiries.resume(inquiry.id);
  const datacenter = await pageFrom(browser, stack.apiUrl, PROVIDER_RANGE);
  await datacenter.goto(first.meta['flow-url']);
  await expect(
    datacenter.getByRole('heading', { level: 1, name: 'Consent to use your biometric data' }),
  ).toBeVisible();
  await datacenter.context().close();

  // Session B, from a Tor exit: consent, the database step, then completion.
  const second = await client.inquiries.resume(inquiry.id);
  const tor = await pageFrom(browser, stack.apiUrl, TOR_EXIT);
  const errors = collectConsoleErrors(tor);
  await tor.goto(second.meta['flow-url']);
  await giveConsent(tor);
  await enterDatabaseRecord(tor);
  await expect(tor.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible({
    timeout: 60_000,
  });
  expect(errors).toEqual([]);
  await tor.context().close();

  // The signals job runs once the inquiry completes, then the rule moves it to review.
  let served: Awaited<ReturnType<typeof client.inquiries.retrieve>>['data'] | undefined;
  await expect
    .poll(
      async () => {
        served = (await client.inquiries.retrieve(inquiry.id)).data;
        return served.attributes['signal-details']?.['computed-at'] ?? null;
      },
      { timeout: 45_000, intervals: [500, 1000] },
    )
    .not.toBeNull();
  const signals = Object.fromEntries(
    (served?.attributes.signals ?? []).map(({ name, value }) => [name, value]),
  );
  expect(signals).toMatchObject({
    'inquiry/tor_detected': true,
    'inquiry/datacenter_detected': true,
    'inquiry/network_threat_level': 'high',
    'inquiry/session_count': 2,
    'inquiry/country_from_session': 'ZZ',
  });
  // C94.8: navigator.webdriver is a strong artefact, so the score is in the strong band.
  expect(signals['inquiry/bot_score']).toBeGreaterThanOrEqual(90);
  expect(signals['inquiry/automation_artefact_count']).toBeGreaterThanOrEqual(1);
  const details = served?.attributes['signal-details'] as Record<string, unknown> | undefined;
  expect(details?.['inquiry/bot_score']).toMatchObject({
    tier: 'H',
    confidence: expect.any(Number),
  });
  expect(details?.review).toMatchObject({ cause: 'signal_rule' });
  expect(served?.attributes.status).toBe('needs_review');

  // C91.1, C91.3: each session serves its own network facts, with provenance and the trust mode.
  const { data: sessions } = await client.inquirySessions.list({
    filter: { 'inquiry-id': inquiry.id },
  });
  expect(sessions).toHaveLength(2);
  const facts = sessions.map((session) => ({
    tor: session.attributes['is-tor'],
    datacenter: session.attributes['is-datacenter'],
    threat: session.attributes['threat-level'],
    country: session.attributes['country-code'],
  }));
  expect(facts).toEqual(
    expect.arrayContaining([
      { tor: true, datacenter: null, threat: 'high', country: 'ZZ' },
      { tor: false, datacenter: true, threat: 'medium', country: 'ZZ' },
    ]),
  );
  for (const session of sessions) {
    const document = await client.inquirySessions.retrieve(session.id, { include: 'network' });
    const network = document.included?.find((resource) => resource.type === 'network');
    expect(network?.attributes).toMatchObject({
      'client-address-source': 'trusted-list',
      sources: expect.arrayContaining([
        expect.objectContaining({ 'source-id': 'openverify-sandbox-network' }),
      ]),
    });
  }
});
