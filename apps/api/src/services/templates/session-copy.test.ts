/**
 * C162.6, C162.9 (Workflow 9A): a session carries the copy of its version's enabled locales, the
 * built-in-key overrides and the current step's component texts only; and consent is recorded only
 * when each digest a client sends is the SHA-256 of a stored template text (the version's custom copy,
 * or a released built-in text of `consent-texts.json`) with the session's placeholders filled
 * (`days`, `organization`), NFC-normalised. A client that sends no digest is accepted, never matched.
 * Every text and value is synthetic.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  environments,
  inquiryTemplateVersions,
  getInquiry,
  getInquiryTemplateVersion,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { bearer, createTemplate } from '../../test-support/harness.js';
import { checkConsentTextsInTx } from './consent-texts.js';
import { resolveCopyForSession } from './copy.js';

let api: InquiryTestApi;
let inquiryId: string;
let versionId: string;

const table = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/i18n/consent-texts.json', import.meta.url),
    'utf8',
  ),
) as { entries: { key: string; locale: string; text: string }[] };
const builtIn = (key: string) =>
  table.entries.find((entry) => entry.key === key && entry.locale === 'en')?.text ?? '';
const digest = (text: string) =>
  createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');

beforeAll(async () => {
  api = await createInquiryTestApi();
  const templateId = await createTemplate(api, api.token);
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiries',
    headers: bearer(api.token),
    payload: { data: { attributes: { 'inquiry-template-id': templateId } } },
  });
  inquiryId = created.json<{ data: { id: string } }>().data.id;
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  versionId = inquiry?.inquiryTemplateVersionId ?? '';
});

afterAll(async () => {
  await api.close();
});

const session = () => ({
  environmentId: api.environmentId,
  inquiryId,
  sessionId: 'iss_01M5CJXHG07XPHF3HRM6NREDH8',
});
const check = (body: Record<string, unknown>) =>
  checkConsentTextsInTx(api.database.db, session(), {
    'text-keys': ['consent.biometric-matching'],
    locale: 'en',
    ...body,
  } as never);

async function setRetention(days: number) {
  const [row] = await api.database.db
    .select()
    .from(environments)
    .where(eq(environments.id, api.environmentId));
  await api.database.db
    .update(environments)
    .set({ settings: { ...row?.settings, 'face-template-retention-days': days } })
    .where(eq(environments.id, api.environmentId));
}

describe('the consent text check (C162.9)', () => {
  it('accepts a body with no digest, as today', async () => {
    await expect(check({})).resolves.toBeUndefined();
  });

  it('accepts the built-in biometric matching text at two retention values, and refuses another', async () => {
    for (const days of [30, 90]) {
      await setRetention(days);
      const text = builtIn('consent.biometric-matching').replaceAll('{{days}}', String(days));
      await expect(
        check({ 'text-sha256': [digest(text)], 'copy-source': 'built-in' }),
      ).resolves.toBeUndefined();
    }
    const wrong = builtIn('consent.biometric-matching').replaceAll('{{days}}', '7');
    await expect(check({ 'text-sha256': [digest(wrong)] })).rejects.toMatchObject({
      status: 422,
      code: 'consent_text_mismatch',
    });
  });

  it('accepts a custom override with {days} filled, and refuses the built-in words as custom', async () => {
    await setRetention(45);
    const custom = 'We keep your face template for {days} days to compare it.';
    await api.database.db
      .update(inquiryTemplateVersions)
      .set({ copy: { messages: { en: { 'consent.biometric-matching': custom } } } })
      .where(eq(inquiryTemplateVersions.id, versionId));
    await expect(
      check({ 'text-sha256': [digest(custom.replace('{days}', '45'))], 'copy-source': 'custom' }),
    ).resolves.toBeUndefined();
    const builtInText = builtIn('consent.biometric-matching').replaceAll('{{days}}', '45');
    await expect(
      check({ 'text-sha256': [digest(builtInText)], 'copy-source': 'custom' }),
    ).rejects.toMatchObject({ code: 'consent_text_mismatch' });
  });
});

describe("the session's copy (C162.6)", () => {
  it("carries the enabled locales' overrides and the current step's component texts only", async () => {
    await api.database.db
      .update(inquiryTemplateVersions)
      .set({
        enabledLocales: ['en', 'fr'],
        copy: {
          messages: {
            en: {
              'completion.title': 'Thanks',
              'extra_details.nickname.label': 'Nickname',
              'other_step.x.label': 'Hidden',
            },
            fr: { 'completion.title': 'Merci' },
            de: { 'completion.title': 'Danke' },
          },
        },
      })
      .where(eq(inquiryTemplateVersions.id, versionId));
    const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
    const version = await getInquiryTemplateVersion(api.database.db, api.environmentId, versionId);
    if (inquiry === null || version === null) throw new Error('seeded rows are missing');
    expect(
      await resolveCopyForSession(api.database.db, { inquiry, version, stepId: 'extra_details' }),
    ).toEqual({
      messages: {
        en: { 'completion.title': 'Thanks', 'extra_details.nickname.label': 'Nickname' },
        fr: { 'completion.title': 'Merci' },
      },
    });
    await api.database.db
      .update(inquiryTemplateVersions)
      .set({ copy: {} })
      .where(eq(inquiryTemplateVersions.id, versionId));
    const plain = await getInquiryTemplateVersion(api.database.db, api.environmentId, versionId);
    if (plain === null) throw new Error('seeded rows are missing');
    expect(
      await resolveCopyForSession(api.database.db, { inquiry, version: plain, stepId: null }),
    ).toBeNull();
  });
});
