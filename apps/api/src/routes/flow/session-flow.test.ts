/**
 * C151.5-C151.7, V03 (Workflow 9A, api-flow-engine, checkpoint "session"): `GET /flow/session`
 * serves the server's position. Its `flow` member is the v1 projection, and at each of
 * `contracts-9a`'s golden positions the body carries the golden projection byte for byte (member
 * order included), so today's Android SDK (`FlowCoordinatorProjectionTest`) and the server cannot
 * drift apart. The screen route answers the session too, with the version the client declared in
 * `OpenVerify-Flow-Spec` and that version named in the response header. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  listInquirySessions,
  recordInquirySessionConsent,
  updateEnvironmentSettings,
} from '@openverify/db';
import { flowV2Schema } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { storeFlowPosition } from '../../flow-engine/testing.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus, resumeInquiry } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const FIXTURES = fileURLToPath(new URL('../../../../../contracts/fixtures/', import.meta.url));
const fixture = (path: string): unknown => JSON.parse(readFileSync(FIXTURES + path, 'utf8'));

interface ProjectionCase {
  projection: string;
  flow: string;
  position: {
    current: string;
    exited: { stepId: string; port: string }[];
    verificationStatuses: Record<string, string>;
    consentRecorded: boolean;
    customConsentCopy: boolean;
  };
}

const CASES = (fixture('flows/v2/projection-cases.json') as { cases: ProjectionCase[] }).cases;

/** A session token of `inquiryId`, its session's consent recorded when `consent`. */
async function sessionOf(inquiryId: string, consent: boolean): Promise<string> {
  const token = await resumeInquiry(api, inquiryId);
  if (consent) {
    const [session] = (await listInquirySessions(api.database.db, api.environmentId, { inquiryId }))
      .items;
    await recordInquirySessionConsent(api.database.db, api.environmentId, session?.id ?? '', {
      acceptedAt: api.clock.now(),
      textKeys: ['consent.biometric'],
      optionalTextKeys: [],
      locale: 'en',
      ip: null,
      userAgent: null,
    });
  }
  return token;
}

describe('GET /api/v1/flow/session serves the golden projection byte for byte (C151.6, V03)', () => {
  it.each(CASES.map((entry) => [entry.projection, entry] as const))('%s', async (_, entry) => {
    const flow = flowV2Schema.parse(fixture(entry.flow));
    const inquiryId = await storeFlowPosition(api, flow, entry.position);
    if (entry.position.customConsentCopy) {
      await api.database.db.execute(
        sql`update inquiry_template_versions
               set copy = ${JSON.stringify({ messages: { en: { 'consent.biometric': 'Our own words.' } } })}::jsonb
             where id = (select inquiry_template_version_id from inquiries where id = ${inquiryId})`,
      );
    }
    const token = await sessionOf(inquiryId, entry.position.consentRecorded);
    const response = await api.app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(token),
    });
    const body = expectStatus(response, 200) as unknown as { flow: unknown; position: unknown };
    expect(JSON.stringify(body.flow)).toBe(JSON.stringify(fixture(entry.projection)));
    expect(body.position).toMatchObject({ 'step-id': entry.position.current });
  });
});

describe('the session the screen route answers (C151.5, C151.7)', () => {
  const FLOW = flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'negotiated', version: 1, name: 'Negotiated' },
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      {
        id: 'about',
        type: 'screen',
        name: 'Internal name',
        components: [
          { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
          { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        ],
      },
      {
        id: 'more',
        type: 'screen',
        components: [
          { id: 'city', kind: 'text_input', field: 'city', labelKey: 'more.city' },
          { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        ],
      },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      { id: 'e1', from: 'consent', port: 'next', to: 'about' },
      { id: 'e2', from: 'about', port: 'next', to: 'more' },
      { id: 'e3', from: 'more', port: 'next', to: 'done' },
    ],
  });

  it('sends the next step’s client view and values to a client that declared spec 2, and names the version served', async () => {
    const inquiryId = await storeFlowPosition(api, FLOW, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    const token = await sessionOf(inquiryId, true);
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/screens/about/submit',
      headers: { ...bearer(token), 'openverify-flow-spec': '1, 2' },
      payload: { values: { nickname: 'Ada' } },
    });
    const body = expectStatus(response, 200) as unknown as Record<string, unknown>;
    expect(response.headers['openverify-flow-spec']).toBe('2');
    expect(body).toMatchObject({
      position: { 'step-id': 'more', state: 'active', 'previous-step-id': 'about' },
      step: { id: 'more', type: 'screen' },
      values: { city: null },
      'spec-version': 2,
    });
    expect(JSON.stringify(body)).not.toContain('Internal name');
  });

  it('serves spec 1 without a step to a client that declared none', async () => {
    const inquiryId = await storeFlowPosition(api, FLOW, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    const token = await sessionOf(inquiryId, true);
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/screens/about/submit',
      headers: bearer(token),
      payload: { values: { nickname: 'Ada' } },
    });
    const body = expectStatus(response, 200) as unknown as Record<string, unknown>;
    expect(response.headers['openverify-flow-spec']).toBe('1');
    expect(body['spec-version']).toBe(1);
    expect(body).not.toHaveProperty('step');
    expect(body).not.toHaveProperty('values');
  });

  it('names the origins that may frame the flow and the completion redirect, on every read (C158.5, C159.4)', async () => {
    await updateEnvironmentSettings(api.database.db, api.environmentId, {
      'allowed-embed-origins': ['https://shop.example.com', 'https://*.example.org'],
      'allowed-redirect-origins': ['https://shop.example.com'],
    });
    onTestFinished(async () => {
      await updateEnvironmentSettings(api.database.db, api.environmentId, {
        'allowed-embed-origins': [],
        'allowed-redirect-origins': null,
      });
    });
    const inquiryId = await storeFlowPosition(api, FLOW, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    await api.database.db.execute(
      sql`update inquiry_template_versions
             set redirect_uri = 'https://shop.example.com/done',
                 embed_origins = '{https://shop.example.com}'::text[]
           where id = (select inquiry_template_version_id from inquiries where id = ${inquiryId})`,
    );
    const token = await sessionOf(inquiryId, true);
    const body = expectStatus(
      await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }),
      200,
    ) as unknown as Record<string, unknown>;
    expect(body.embed).toEqual({ 'allowed-origins': ['https://shop.example.com'] });
    expect(body.completion).toEqual({
      'redirect-url': `https://shop.example.com/done?inquiry-id=${inquiryId}`,
    });
  });

  it('sends no redirect a current list no longer allows, and no origin of an empty list', async () => {
    const inquiryId = await storeFlowPosition(api, FLOW, {
      current: 'about',
      exited: [{ stepId: 'consent', port: 'next' }],
    });
    await api.database.db.execute(
      sql`update inquiry_template_versions set redirect_uri = 'https://elsewhere.example.net/done'
           where id = (select inquiry_template_version_id from inquiries where id = ${inquiryId})`,
    );
    const token = await sessionOf(inquiryId, true);
    const body = expectStatus(
      await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }),
      200,
    ) as unknown as Record<string, unknown>;
    expect(body.embed).toEqual({ 'allowed-origins': [] });
    expect(body.completion).toEqual({ 'redirect-url': null });
  });
});
