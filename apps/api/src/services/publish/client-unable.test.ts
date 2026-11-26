/**
 * C207.9 (Phase 10, Workflow 10C; `api-nfc`; Phase 9 C150.6 and C154.9 amended) at publish and
 * validate, through `flowPublishReport` (the analyses of `@openverify/flow-spec`):
 *
 * - an `nfc` step whose `exhausted` fallback continues asks `client-unable:<step id>` beside
 *   `fallback:<step id>`; a publish without it is refused, and a user who gives both has both
 *   stored on the version, which is what lets a client-unable exit complete without review;
 * - an `nfc` step without an `exhausted` edge is published with the warning
 *   `nfc_fallback_missing`, which never blocks.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { createRole, createUser, setUserRoles } from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTemplate, expectStatus } from '../../test-support/harness.js';
import { nfcTemplateAttributes } from '../chip-challenges/testing.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const defaults = defaultInquiryTemplateAttributes()['verification-config'];

/** consent, a selfie, the chip, completion; the chip's fallback as given. */
const flowWith = (chip: Record<string, unknown>, fallback: boolean) => ({
  metadata: { specVersion: 2, id: 'chip-publish', version: 1, name: 'Chip publish' },
  entry: 'consent',
  steps: [
    {
      id: 'consent',
      type: 'consent',
      textKeys: ['consent.biometric', 'consent.processing'],
      required: true,
    },
    { id: 'face', type: 'selfie', poses: ['center'], liveness: 'passive', maxAttempts: 3 },
    { id: 'chip', type: 'nfc', androidOnly: true, ...chip },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    { id: 'e0', from: 'consent', port: 'next', to: 'face' },
    { id: 'e1', from: 'face', port: 'next', to: 'chip' },
    { id: 'e2', from: 'chip', port: 'next', to: 'done' },
    ...(fallback ? [{ id: 'e3', from: 'chip', port: 'exhausted', to: 'done' }] : []),
  ],
});

async function draft(chip: Record<string, unknown>, fallback: boolean): Promise<string> {
  const templateId = await createTemplate(api, api.token);
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-template-versions',
    headers: bearer(api.token),
    payload: {
      data: {
        attributes: {
          'inquiry-template-id': templateId,
          flow: flowWith(chip, fallback),
          'verification-config': {
            'government-id-nfc':
              nfcTemplateAttributes()['verification-config']['government-id-nfc'],
            selfie: {
              ...defaults.selfie,
              checks: {
                ...defaults.selfie?.checks,
                selfie_id_comparison: { enabled: false, required: false },
              },
            },
          },
        },
      },
    },
  });
  return expectStatus(created, 201).data.id;
}

interface Validation {
  'acknowledgements-required': string[];
  validation: unknown;
}

async function validated(versionId: string): Promise<Validation> {
  const body = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-template-versions/${versionId}/validate`,
      headers: bearer(api.token),
      payload: { meta: { mode: 'publish' } },
    }),
    200,
  );
  return body.data.attributes as unknown as Validation;
}

const publish = (versionId: string, token: string, acknowledgements?: string[]) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiry-template-versions/${versionId}/publish`,
    headers: bearer(token),
    payload: acknowledgements === undefined ? {} : { meta: { acknowledgements } },
  });

/** A user of the organization who may write templates, with its session token. */
async function userToken(): Promise<string> {
  const id = testId('usr');
  await createUser(api.database.db, {
    id,
    organizationId: api.organizationId,
    email: `${id}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$change-me$change-me',
  });
  const role = await createRole(api.database.db, api.organizationId, {
    id: testId('role'),
    name: `Publisher ${id}`,
    permissions: ['inquiry-templates:read', 'inquiry-templates:write'],
  });
  await setUserRoles(api.database.db, api.organizationId, id, [role.id]);
  return api.newUserToken(api.environmentId, { userId: id });
}

describe('client-unable:<step id> at publish (C207.9)', () => {
  it('is asked beside fallback: for an nfc step whose fallback continues', async () => {
    const report = await validated(await draft({ onFallback: 'continue' }, true));

    expect(report['acknowledgements-required']).toEqual(
      expect.arrayContaining(['fallback:chip', 'client-unable:chip']),
    );
    expect(JSON.stringify(report.validation)).not.toContain('nfc_fallback_missing');
  });

  it('is not asked while the fallback goes to review', async () => {
    const report = await validated(await draft({}, true));

    expect(
      report['acknowledgements-required'].filter((key) => key.startsWith('client-unable:')),
    ).toEqual([]);
  });

  it('refuses a publish that does not carry it, naming it', async () => {
    const versionId = await draft({ onFallback: 'continue' }, true);
    const token = await userToken();

    const response = await publish(versionId, token, ['fallback:chip']);

    expect(response.statusCode).toBe(422);
    const body = response.json<{ code: string; errors: { detail: string }[] }>();
    expect(body.code).toBe('publish_acknowledgement_missing');
    expect(body.errors.map((error) => error.detail)).toEqual(['client-unable:chip']);
  });

  it('stores both on the version once a user gives both', async () => {
    const versionId = await draft({ onFallback: 'continue' }, true);
    const token = await userToken();

    const response = await publish(versionId, token, ['fallback:chip', 'client-unable:chip']);

    expect(response.statusCode, response.body).toBe(200);
    const { rows } = await api.database.client.query<{ acknowledgements: { key: string }[] }>(
      'select acknowledgements from inquiry_template_versions where id = $1',
      [versionId],
    );
    expect(rows[0]?.acknowledgements.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['fallback:chip', 'client-unable:chip']),
    );
  });
});

describe('nfc_fallback_missing at publish (C207.9; review H11)', () => {
  it('warns about an nfc step without an exhausted edge, at the step', async () => {
    const report = await validated(await draft({}, false));

    expect(report.validation).toMatchObject({
      problems: expect.arrayContaining([
        expect.objectContaining({
          code: 'nfc_fallback_missing',
          severity: 'warning',
          pointer: '/flow/steps/2',
        }),
      ]) as unknown,
    });
  });

  it('never blocks the publish', async () => {
    const response = await publish(await draft({}, false), api.token);

    expect(response.statusCode, response.body).toBe(200);
  });
});
