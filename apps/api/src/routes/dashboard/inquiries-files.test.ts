/**
 * C15 on the C4 dashboard inquiry and file routes: permissions, PII masking, redaction (410)
 * and the trusted client address of `file.viewed`. Phase 1 behaviour is in `index.test.ts`.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  FILE_CONTENT_CACHE_CONTROL,
  dashboardInquiryDocumentSchema,
  dashboardInquiryListDocumentSchema,
  newId,
} from '@openverify/contracts';
import {
  createFile,
  createRole,
  createVerification,
  encryptBytes,
  markFilesDeleted,
  updateInquiry,
} from '@openverify/db';
import { createTestDatabase, createTestInquiry, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BFF_CLIENT_IP_HEADER, BFF_TOKEN_HEADER } from '../../operator-auth/index.js';
import {
  BFF_TOKEN,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

// Synthetic inquiries and images only: no real people, no real faces.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const seeded = await seedInquiry(api, organization);
  const tokenFor = async (roles: Parameters<DashboardHarness['operator']>[1]) =>
    api.signIn((await api.operator(organization, roles)).email);
  return { api, organization, ...seeded, tokenFor };
}

/** An inquiry with fields, a note and a government ID verification with one stored file. */
async function seedInquiry(api: DashboardHarness, organization: TestOrganization) {
  const environmentId = organization.sandboxId;
  const { inquiry } = await createTestInquiry(database.db, environmentId, {
    fields: { name_first: 'Synthetic', name_last: 'Person' },
  });
  await updateInquiry(database.db, environmentId, inquiry.id, { note: 'Synthetic operator note' });
  const verification = await createVerification(database.db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  const fileId = newId('file');
  const bytes = Buffer.concat([PNG_SIGNATURE, randomBytes(32)]);
  const sealed = encryptBytes(bytes, database.keyring, { context: fileId });
  const storageKey = `${environmentId}/${fileId}`;
  await api.storage.put(storageKey, sealed.ciphertext);
  await createFile(database.db, environmentId, {
    id: fileId,
    verificationId: verification.id,
    kind: 'front',
    storageKey,
    mimeType: 'image/png',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  return { inquiryId: inquiry.id, fileId, bytes };
}

describe('GET /inquiries and /inquiries/:id (C15)', () => {
  it('shows PII to a user with pii:view', async () => {
    const { api, inquiryId, tokenFor } = await setup();
    const token = await tokenFor({ roles: ['reviewer'] });

    const detail = dashboardInquiryDocumentSchema.parse(
      expectJson(await api.call('GET', `/inquiries/${inquiryId}`, { token }), 200),
    );

    expect(detail.data.attributes).toMatchObject({
      fields: { name_first: 'Synthetic', name_last: 'Person' },
      note: 'Synthetic operator note',
      tags: [],
      'redacted-at': null,
    });
    expect(detail.data.relationships.account?.data?.id).toMatch(/^acc_/);
  });

  it('masks fields and the note for a user without pii:view, in the list and the detail', async () => {
    const { api, inquiryId, tokenFor } = await setup();
    const token = await tokenFor({ roles: ['viewer'] });

    const list = dashboardInquiryListDocumentSchema.parse(
      expectJson(await api.call('GET', '/inquiries', { token }), 200),
    );
    const detail = dashboardInquiryDocumentSchema.parse(
      expectJson(await api.call('GET', `/inquiries/${inquiryId}`, { token }), 200),
    );

    for (const attributes of [list.data[0]?.attributes, detail.data.attributes]) {
      expect(attributes).toMatchObject({
        fields: { name_first: null, name_last: null },
        note: null,
      });
    }
    expect(JSON.stringify(list)).not.toContain('Synthetic');
  });

  it('needs inquiries:read (403)', async () => {
    const { api, organization, inquiryId, tokenFor } = await setup();
    const role = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Settings Reader',
      permissions: ['settings:read'],
    });
    const token = await tokenFor({ roles: [], roleIds: [role.id] });

    for (const path of ['/inquiries', `/inquiries/${inquiryId}`]) {
      const response = await api.call('GET', path, { token });
      expect(response.statusCode, path).toBe(403);
      expect(response.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
    }
  });

  it('leaves the verifications and their files out of included without verifications:read (Workflow 2D K001)', async () => {
    const { api, organization, inquiryId, fileId, tokenFor } = await setup();
    const role = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Inquiry Reader',
      permissions: ['inquiries:read', 'pii:view'],
    });
    const without = await tokenFor({ roles: [], roleIds: [role.id] });
    const withRead = await tokenFor({ roles: ['viewer'] });

    const hidden = dashboardInquiryDocumentSchema.parse(
      expectJson(await api.call('GET', `/inquiries/${inquiryId}`, { token: without }), 200),
    );
    const shown = dashboardInquiryDocumentSchema.parse(
      expectJson(await api.call('GET', `/inquiries/${inquiryId}`, { token: withRead }), 200),
    );

    // The relationship identifiers stay; the resources behind them need verifications:read.
    expect(hidden.data.relationships.verifications.data).toHaveLength(1);
    expect(hidden.included).toEqual([]);
    expect(shown.included.map(({ type, id }) => ({ type, id }))).toEqual([
      {
        type: 'verification/government-id',
        id: hidden.data.relationships.verifications.data[0]?.id,
      },
      { type: 'file', id: fileId },
    ]);
  });

  it('takes the C9 and C10 filters, comma-separated statuses included', async () => {
    const { api, organization, inquiryId, tokenFor } = await setup();
    const token = await tokenFor({ roles: ['viewer'] });
    const other = await createTestInquiry(database.db, organization.sandboxId);

    const both = dashboardInquiryListDocumentSchema.parse(
      expectJson(
        await api.call('GET', '/inquiries?filter[status]=created,pending', { token }),
        200,
      ),
    );
    const none = dashboardInquiryListDocumentSchema.parse(
      expectJson(await api.call('GET', '/inquiries?filter[tag]=absent', { token }), 200),
    );
    const byTemplate = dashboardInquiryListDocumentSchema.parse(
      expectJson(
        await api.call('GET', `/inquiries?filter[inquiry-template-id]=${other.template.id}`, {
          token,
        }),
        200,
      ),
    );

    expect(both.data.map(({ id }) => id)).toEqual([other.inquiry.id, inquiryId]);
    expect(none.data).toEqual([]);
    expect(byTemplate.data.map(({ id }) => id)).toEqual([other.inquiry.id]);
  });
});

describe('GET /files/:id/content (C15, C16)', () => {
  it('needs pii:view: 403 forbidden for a viewer, the image for a reviewer', async () => {
    const { api, fileId, bytes, tokenFor } = await setup();
    const viewer = await tokenFor({ roles: ['viewer'] });
    const reviewer = await tokenFor({ roles: ['reviewer'] });

    const forbidden = await api.call('GET', `/files/${fileId}/content`, { token: viewer });
    const allowed = await api.call('GET', `/files/${fileId}/content`, { token: reviewer });

    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.rawPayload.equals(bytes)).toBe(true);
  });

  it('records file.viewed with the operator’s address behind the BFF and the user agent', async () => {
    const { api, organization, fileId, tokenFor } = await setup();
    const token = await tokenFor({ roles: ['reviewer'] });

    const response = await api.call('GET', `/files/${fileId}/content`, {
      token,
      headers: {
        [BFF_TOKEN_HEADER]: BFF_TOKEN,
        [BFF_CLIENT_IP_HEADER]: '198.51.100.77',
        'user-agent': 'Synthetic Browser/3.0',
      },
      remoteAddress: '10.0.0.5',
    });

    expect(response.statusCode).toBe(200);
    const [entry] = await api.audit(organization.sandboxId, 'file.viewed');
    expect(entry).toMatchObject({
      resourceId: fileId,
      ip: '198.51.100.77',
      userAgent: 'Synthetic Browser/3.0',
    });
  });

  it('answers 410 redacted once the file was deleted by redaction, and once its inquiry is redacted', async () => {
    const first = await setup();
    const second = await setup();
    const firstToken = await first.tokenFor({ roles: ['admin'] });
    const secondToken = await second.tokenFor({ roles: ['admin'] });
    await markFilesDeleted(database.db, first.organization.sandboxId, [first.fileId]);
    await database.client.query('update inquiries set redacted_at = now() where id = $1', [
      second.inquiryId,
    ]);

    for (const [api, token, fileId] of [
      [first.api, firstToken, first.fileId],
      [second.api, secondToken, second.fileId],
    ] as const) {
      const response = await api.call('GET', `/files/${fileId}/content`, { token });
      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({ type: 'https://openverify.dev/problems/redacted' });
      expect(response.headers['cache-control']).toBe(FILE_CONTENT_CACHE_CONTROL);
    }
    expect(await first.api.audit(first.organization.sandboxId, 'file.viewed')).toEqual([]);
  });
});
