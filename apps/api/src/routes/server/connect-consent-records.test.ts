/**
 * C236 (Workflow 11A, `api-consent` checkpoint 1): consent records on the server API.
 *
 * - The attestation (C236.5): `witnessed: false`, the operator's text sealed on the record with the
 *   digest the server computes, the evidence reference sealed, `attested-at` within the last 30 days
 *   and never in the future, the biometric category only with `explicit-biometric`, the connection
 *   the caller's (the source side's recipient its destination, never another), and refused within a
 *   witnessed decline's validity on the subject or its account (409 `consent_declined_in_flow`, V08).
 * - The list and the retrieve (C236.2): the caller's environment only, every refusal the one 404
 *   (C232.8), the PII members only with `pii:view` (C236.1), the derived status (H27).
 * - The scope `connect-consent-records:attest` is its own (review P03).
 * - `consent-record.created` in the record's environment, never carrying evidence (C239.2).
 *
 * Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import {
  API_SCOPES,
  buildEventResource,
  consentRecordDocumentSchema,
  consentRecordListDocumentSchema,
  CONNECT_NOT_FOUND_PROBLEM,
} from '@openverify/contracts';
import { createConsentRecord } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedConnection } from '../../services/connect/consent.test-support.js';
import { bearer, createInquiry, createTestApi, type TestApi } from '../../test-support/harness.js';

const PATH = '/api/v1/connect/consent-records';
const BODY = 'I agree that Example Source shares my verification with Example Partner.';
const digest = (text: string) =>
  createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');

let api: TestApi;
let destination: Awaited<ReturnType<TestApi['newTenant']>>;
let connection: { id: string; policyId: string };

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
  destination = await api.newTenant();
  connection = await seedConnection(api.database.db, {
    sourceOrganizationId: api.organizationId,
    destinationOrganizationId: destination.organizationId,
  });
});

afterAll(async () => {
  await api.close();
});

const attestBody = (attributes: Record<string, unknown>) => ({
  data: {
    type: 'consent-record',
    attributes: {
      side: 'source',
      'connection-id': connection.id,
      'data-categories': ['identity-fields', 'check-results'],
      'explicit-biometric': false,
      'expires-in-seconds': 86_400,
      'evidence-reference': 'synthetic-ticket-42',
      'attested-at': new Date(api.clock.now().getTime() - 3_600_000).toISOString(),
      'text-locale': 'en',
      'text-body': BODY,
      ...attributes,
    },
  },
});

let keys = 0;
const attest = (attributes: Record<string, unknown>, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: PATH,
    headers: { ...bearer(token), 'idempotency-key': `synthetic-attest-${String((keys += 1))}` },
    payload: attestBody(attributes),
  });

const genericOf = (body: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(body) as Record<string, unknown>).filter(
      ([member]) => member !== 'instance' && member !== 'requestId',
    ),
  );

describe('POST /connect/consent-records: an attested record (C236.5)', () => {
  it('records the operator’s statement, not witnessed, with its digest, sealed text and event', async () => {
    const inquiryId = await createInquiry(api);
    const response = await attest({ 'subject-id': inquiryId });
    expect(response.statusCode, response.body).toBe(201);
    const document = consentRecordDocumentSchema.parse(response.json());
    expect(response.headers.location).toBe(`${PATH}/${document.data.id}`);
    expect(document.data.attributes).toMatchObject({
      side: 'source',
      outcome: 'accepted',
      status: 'active',
      method: 'attested',
      witnessed: false,
      purpose: 'share.reuse-kyc',
      'recipient-organization-id': destination.organizationId,
      'recipient-name': 'Example Test Org',
      text: { locale: 'en', keys: [], sha256: digest(BODY) },
      'evidence-reference': 'synthetic-ticket-42',
      'text-body': BODY,
      'ip-address': null,
      'user-agent': null,
    });
    expect(document.data.relationships.subject.data).toEqual({ type: 'inquiry', id: inquiryId });
    expect(document.data.relationships.connection.data.id).toBe(connection.id);
    expect(document.data.attributes.evidence).toEqual({
      'attested-at': new Date(api.clock.now().getTime() - 3_600_000).toISOString(),
    });

    const [event] = api.events.named('consent-record.created').slice(-1);
    expect(event?.environmentId).toBe(api.environmentId);
    // The real publisher validates the payload with the contract, which refuses evidence.
    expect(() =>
      buildEventResource({
        id: 'evt_01M5CN0000000000000011A514',
        name: 'consent-record.created',
        payload: event?.payload as never,
        createdAt: new Date(),
      }),
    ).not.toThrow();
    expect(JSON.stringify(event?.payload)).not.toContain('synthetic-ticket-42');
    expect(JSON.stringify(event?.payload)).not.toContain(BODY);
    expect(api.audit.withAction('consent-record.created').at(-1)).toMatchObject({
      resourceType: 'consent-record',
      resourceId: document.data.id,
    });
    // The text is sealed on the record, never stored in plaintext.
    const raw = await api.database.client.query<{ attested_text_body: string }>(
      'select attested_text_body, evidence_reference from consent_records where id = $1',
      [document.data.id],
    );
    expect(JSON.stringify(raw.rows)).not.toContain('synthetic-ticket-42');
    expect(JSON.stringify(raw.rows)).not.toContain(BODY);
  });

  it('refuses an attestation in the future or older than 30 days', async () => {
    const inquiryId = await createInquiry(api);
    const now = api.clock.now().getTime();
    for (const at of [now + 60_000, now - 31 * 86_400_000]) {
      const response = await attest({
        'subject-id': inquiryId,
        'attested-at': new Date(at).toISOString(),
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json<{ errors: { pointer: string }[] }>().errors[0]?.pointer).toBe(
        '/data/attributes/attested-at',
      );
    }
  });

  it('refuses the biometric category without explicit-biometric', async () => {
    const inquiryId = await createInquiry(api);
    const response = await attest({
      'subject-id': inquiryId,
      'data-categories': ['biometric'],
      'explicit-biometric': false,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe('explicit_consent_required');
  });

  it('answers the one 404 for a connection that is not the caller’s outbound one or a subject not here', async () => {
    const inquiryId = await createInquiry(api);
    const stranger = await api.newTenant();
    const theirs = await seedConnection(api.database.db, {
      sourceOrganizationId: stranger.organizationId,
      destinationOrganizationId: destination.organizationId,
    });
    const inbound = await seedConnection(api.database.db, {
      sourceOrganizationId: stranger.organizationId,
      destinationOrganizationId: api.organizationId,
    });
    const refusals = [
      await attest({ 'subject-id': inquiryId, 'connection-id': theirs.id }),
      await attest({ 'subject-id': inquiryId, 'connection-id': inbound.id }),
      await attest({ 'subject-id': 'inq_01M5CN0000000000000011A999' }),
      await attest({ 'subject-id': await createInquiry(api, { token: stranger.token }) }),
    ];
    const bodies = refusals.map((response) => {
      expect(response.statusCode, response.body).toBe(404);
      return genericOf(response.body);
    });
    for (const body of bodies) {
      expect(body).toEqual(CONNECT_NOT_FOUND_PROBLEM);
    }
  });

  it('refuses an attestation while a witnessed decline stands on the subject or its account (V08)', async () => {
    const declinedInquiry = await createInquiry(api, { referenceId: 'synthetic-person-1' });
    const sameAccount = await createInquiry(api, { referenceId: 'synthetic-person-1' });
    const accountId = (
      await api.database.client.query<{ account_id: string }>(
        'select account_id from inquiries where id = $1',
        [declinedInquiry],
      )
    ).rows[0]?.account_id;
    await createConsentRecord(api.database.db, api.environmentId, {
      id: 'cnsr_01M5CN0000000000000011A777',
      side: 'source',
      outcome: 'declined',
      purpose: 'share.reuse-kyc',
      subjectType: 'inquiry',
      subjectId: declinedInquiry,
      connectionId: connection.id,
      recipientOrganizationId: destination.organizationId,
      recipientName: 'Example Test Org',
      dataCategories: ['identity-fields'],
      explicitBiometric: false,
      textLocale: 'en',
      textKeys: ['share.consent.source'],
      textSha256: 'a'.repeat(64),
      method: 'flow',
      sessionId: 'iqse_01M5CN0000000000000011A778',
      expiresAt: new Date(api.clock.now().getTime() + 86_400_000),
    });
    for (const subject of [declinedInquiry, sameAccount, accountId]) {
      const response = await attest({ 'subject-id': subject });
      expect(response.statusCode, `${String(subject)} ${response.body}`).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('consent_declined_in_flow');
    }
    // Another person's inquiry is not covered by the decline.
    const response = await attest({ 'subject-id': await createInquiry(api) });
    expect(response.statusCode, response.body).toBe(201);
  });

  it('needs its own scope: connect-share-tokens:write does not imply it (review P03)', async () => {
    const token = await api.newApiKey(api.environmentId, {
      scopes: API_SCOPES.filter((scope) => scope !== 'connect-consent-records:attest'),
    });
    const response = await attest({ 'subject-id': await createInquiry(api) }, token);
    expect(response.statusCode).toBe(403);
  });
});

describe('GET /connect/consent-records (C236.2)', () => {
  it('lists the environment’s records newest first and retrieves one, PII only with pii:view', async () => {
    const inquiryId = await createInquiry(api);
    const created = await attest({ 'subject-id': inquiryId });
    const id = created.json<{ data: { id: string } }>().data.id;

    const list = await api.app.inject({
      url: `${PATH}?filter[subject-id]=${inquiryId}&filter[side]=source&filter[status]=active`,
      headers: bearer(api.token),
    });
    expect(list.statusCode, list.body).toBe(200);
    const listed = consentRecordListDocumentSchema.parse(list.json());
    expect(listed.data.map((record) => record.id)).toEqual([id]);

    const masked = await api.newApiKey(api.environmentId, { piiMasked: true });
    const retrieved = await api.app.inject({ url: `${PATH}/${id}`, headers: bearer(masked) });
    expect(retrieved.statusCode).toBe(200);
    const attributes = consentRecordDocumentSchema.parse(retrieved.json()).data.attributes;
    expect(attributes['evidence-reference']).toBeNull();
    expect(attributes['text-body']).toBeNull();
    expect(attributes.witnessed).toBe(false);

    const none = await api.app.inject({
      url: `${PATH}?filter[status]=withdrawn&filter[subject-id]=${inquiryId}`,
      headers: bearer(api.token),
    });
    expect(none.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it('answers the one 404 for a record of another environment', async () => {
    const created = await attest({ 'subject-id': await createInquiry(api) });
    const id = created.json<{ data: { id: string } }>().data.id;
    const response = await api.app.inject({
      url: `${PATH}/${id}`,
      headers: bearer(destination.token),
    });
    expect(response.statusCode).toBe(404);
    expect(genericOf(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
  });

  it('answers 400 for a cursor that names no record of the list', async () => {
    const response = await api.app.inject({
      url: `${PATH}?page[after]=cnsr_01M5CN0000000000000011A999`,
      headers: bearer(api.token),
    });
    expect(response.statusCode).toBe(400);
  });
});
