/**
 * C79-C83, C76.2, C89.2 (Workflow 6A): every other report type against the sandbox providers and
 * lists, full stack. Budget: 90 s.
 *
 * - email (`sandbox-breached`): the bound sandbox breach provider answers a breach; an API report
 *   is not deliverable, as only a completion report may read an inquiry's confirmed code (P05);
 * - phone (`555 0103`): the sandbox line-type provider answers a SIM swap within 24 h;
 * - address (house number `1002`): the sandbox postal provider cannot confirm it;
 * - crypto: the sandbox list's party by its listed address, matched exactly;
 * - business: the sandbox company by its LEI, the never-searched lists `null` (H15);
 * - adverse media (`sandbox-media`): two synthetic articles, never a "complete" coverage (C81.5);
 * - PEP: the synthetic answers imported into `wikidata-pep` (`origin: import`), with no
 *   User-Agent set, as an import makes no request (C76.2, V01).
 * No provider, publisher or Wikidata is called. Every value is fictional.
 */
import { randomUUID } from 'node:crypto';
import type { OpenVerifyClient } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { importWatchlist } from './support/commands.js';
import { recordingClient } from './support/platform.js';
import {
  SANDBOX_LISTS,
  assertInFixture,
  attributesOf,
  seededTemplateId,
  waitForReport,
  watchlistFixture,
  type ReportAttributes,
} from './support/reports.js';

type CreateArguments = Parameters<OpenVerifyClient['reports']['create']>;

async function screened(
  client: OpenVerifyClient,
  type: CreateArguments[0],
  attributes: CreateArguments[1],
): Promise<ReportAttributes> {
  const { data } = await client.reports.create(type, attributes, { 'auto-create-account': false });
  return attributesOf(await waitForReport(client, data.id));
}

test('the email, phone, address, crypto, business, adverse media and PEP reports answer from the sandbox providers and lists (C79-C83, C89.2)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().slice(0, 8);
  const template = (type: Parameters<typeof seededTemplateId>[1]) => seededTemplateId(client, type);

  // PEP: the synthetic Wikidata answers, imported as an operator would (no request, no UA).
  const imported = await importWatchlist(
    watchlistFixture('wikidata-pep.synthetic.answers.json'),
    'wikidata-pep',
  );
  expect(imported).toMatchObject({ sourceId: 'wikidata-pep', errorCode: null });
  expect(['applied', 'unchanged']).toContain(imported.outcome);
  const { data: pepTemplate } = await client.reportTemplates.create({
    'report-type': 'politically-exposed-person',
    name: `e2e-pep-import-${run}`,
    config: { 'search-lists': ['wikidata-pep'] },
  });
  await assertInFixture('openverify-sandbox.json', SANDBOX_LISTS.cryptoParty.entryId);
  await assertInFixture('openverify-sandbox.json', SANDBOX_LISTS.business.entryId);

  const [email, phone, address, crypto, business, media, pep] = await Promise.all([
    screened(client, 'report/email-address', {
      'report-template-id': await template('email-address'),
      query: { 'email-address': `e2e-${run}-sandbox-breached@example.test` },
    }),
    screened(client, 'report/phone-number', {
      'report-template-id': await template('phone-number'),
      query: { 'phone-number': '+12025550103' },
    }),
    screened(client, 'report/address-lookup', {
      'report-template-id': await template('address-lookup'),
      query: {
        'address-street-1': '1002 Placeholder Ave',
        'address-city': 'Springfield',
        'address-subdivision': 'IL',
        'address-postal-code': '62704',
        'address-country-code': 'US',
      },
    }),
    screened(client, 'report/crypto-address-watchlist', {
      'report-template-id': await template('crypto-address-watchlist'),
      query: SANDBOX_LISTS.cryptoParty.query,
    }),
    screened(client, 'report/business-watchlist', {
      'report-template-id': await template('business-watchlist'),
      query: SANDBOX_LISTS.business.query,
    }),
    screened(client, 'report/adverse-media', {
      'report-template-id': await template('adverse-media'),
      query: { 'name-first': 'Avery', 'name-last': 'Sandbox-Media' },
    }),
    screened(client, 'report/politically-exposed-person', {
      'report-template-id': pepTemplate.id,
      query: SANDBOX_LISTS.headOfGovernment.query,
    }),
  ]);

  // Email: a breach from the bound sandbox provider; not deliverable for an API report (P05).
  expect(email).toMatchObject({
    status: 'ready',
    'email-credentials-leaked-recent': true,
    'email-is-deliverable': null,
    provider: { sandbox: true },
  });
  expect(email['unavailable-fields']).toEqual(
    expect.arrayContaining([{ field: 'email-is-deliverable', reason: 'not_linked' }]),
  );

  // Phone: a SIM swap within 24 h is high risk; no score is ever synthesised (decision 20).
  expect(phone).toMatchObject({
    status: 'ready',
    'phone-risk-sim-swap': 'high',
    'phone-risk-level': 'high',
    'phone-risk-score': null,
    provider: { sandbox: true },
  });

  // Address: the sandbox postal provider cannot confirm house number 1002.
  expect(address).toMatchObject({ status: 'ready', deliverability: 'not_confirmed' });

  // Crypto: the listed address, matched exactly on its canonical form (C79.3).
  expect(crypto).toMatchObject({ status: 'ready', 'has-match': true });
  expect((crypto.matches as { 'entity-id': string }[]).map((match) => match['entity-id'])).toEqual([
    `openverify-sandbox:${SANDBOX_LISTS.cryptoParty.entryId}`,
  ]);

  // Business: the company by its LEI, whatever the name says (H06); lists never searched are
  // null and listed as unavailable, never empty arrays (H15, decision 18).
  expect(business).toMatchObject({
    status: 'ready',
    'has-match': true,
    'fitness-probity-list': null,
    'warning-list': null,
  });
  expect(business['unavailable-fields']).toEqual(
    expect.arrayContaining([
      { field: 'fitness-probity-list', reason: 'list_not_configured' },
      { field: 'warning-list', reason: 'list_not_configured' },
    ]),
  );
  expect(business.notices).toContain('no_ownership_screening');

  // Adverse media: the synthetic articles, a coverage that is never complete (C81.5, H13).
  expect(media).toMatchObject({ status: 'ready', 'has-match': true, provider: { sandbox: true } });
  expect((media.articles as unknown[]).length).toBe(2);
  expect(media.coverage).toMatchObject({ complete: false });
  expect((media.coverage as { limits: string[] }).limits).toEqual(
    expect.arrayContaining(['title_only', 'window_90_days', 'lexicon_languages']),
  );

  // PEP: the imported holder, cited as an import, never as the publisher's (P08).
  expect(pep).toMatchObject({ status: 'ready', 'has-match': true });
  expect(pep.sources).toEqual([
    expect.objectContaining({ 'source-id': 'wikidata-pep', origin: 'import' }),
  ]);
  const [entity] = pep.result as { 'pep-type': string; positions: { 'pep-class': number }[] }[];
  expect(entity).toMatchObject({ 'pep-type': 'pep' });
  expect(entity?.positions.map((position) => position['pep-class'])).toEqual([1]);
});
