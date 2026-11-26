/**
 * C236, C237 (Workflow 11A): consent records on the server API, under `/api/v1`:
 *
 * - `GET /connect/consent-records` (filters `subject-id`, `side`, `status`, `connection-id`) and
 *   `GET /connect/consent-records/:id`, under `connect-share-tokens:read`; the attested reference, the
 *   IP, the user agent and the text body only with `pii:view`;
 * - `POST /connect/consent-records`, an attested record (C236.5), under its own scope
 *   `connect-consent-records:attest`, labelled "not witnessed";
 * - `POST /connect/consent-records/:id/withdraw` (C237), under `connect-share-tokens:write`: the token
 *   it authorised expires if `created`, fails at commit if `pending`, and the counterparty hears of a
 *   redeemed one; 409 `consent_already_withdrawn` the second time.
 *
 * While the install switch is off every route answers the one generic 404 (C231.10). Frozen by
 * `foundation-11a` (Stage 1b (K)); built by `api-consent` (its file): the list, the retrieve and the
 * attestation (`services/connect/consent.ts`), the withdrawal (`services/connect/withdrawal.ts`).
 * integration-11a dropped the frozen 501 with the OpenAPI snapshot (Stage 1b amendment 10).
 */
import {
  attestConsentRecordBodySchema,
  consentRecordDocumentSchema,
  consentRecordListDocumentSchema,
  consentRecordParamsSchema,
  listConsentRecordsQuerySchema,
  withdrawConsentRecordBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import {
  attestConsentRecord,
  CONSENT_RECORDS_PATH,
  getConsentRecordDocument,
  listConsentRecordsDocument,
} from '../../services/connect/consent.js';
import { connectSwitchHook } from '../../services/connect/switch.js';
import { withdrawConsentRecordAs } from '../../services/connect/withdrawal.js';
import type { ApiDependencies } from '../../services/context.js';
import { actingOf } from './inquiries.js';

const TAGS = ['connect'];

/** C236, C237 consent-record routes, under `/api/v1`. */
export const connectConsentRecordRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.addHook('onRequest', connectSwitchHook(deps.connect));

  app.get(
    '/connect/consent-records',
    {
      config: { scopes: ['connect-share-tokens:read'] },
      schema: {
        summary: 'List consent records',
        description:
          'C236.2: the environment’s records of both sides, newest first (C1), filtered by ' +
          '`subject-id`, `side`, `status` and `connection-id`; evidence only with `pii:view`.',
        tags: TAGS,
        querystring: listConsentRecordsQuerySchema,
        response: {
          200: consentRecordListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => listConsentRecordsDocument(deps, actingOf(request), request.query),
  );

  app.get(
    '/connect/consent-records/:id',
    {
      config: { scopes: ['connect-share-tokens:read'] },
      schema: {
        summary: 'Retrieve a consent record',
        description:
          'C236.1: its side, purpose, recipient, categories, text digest, method, `witnessed`, ' +
          'evidence (sealed parts only with `pii:view`), expiry, withdrawal and status.',
        tags: TAGS,
        params: consentRecordParamsSchema,
        response: { 200: consentRecordDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getConsentRecordDocument(deps, actingOf(request), request.params.id),
  );

  app.post(
    '/connect/consent-records',
    {
      config: { scopes: ['connect-consent-records:attest'] },
      schema: {
        summary: 'Attest a consent record',
        description:
          'C236.5: the operator attests a consent it collected (`witnessed: false`), with its ' +
          'evidence reference, its time (within the last 30 days) and the text that was shown; ' +
          'refused within the step’s validity after a witnessed decline (409 ' +
          '`consent_declined_in_flow`).',
        tags: TAGS,
        body: attestConsentRecordBodySchema,
        response: {
          201: consentRecordDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await attestConsentRecord(deps, actingOf(request), request.body);
      return reply
        .code(201)
        .header('location', `${CONSENT_RECORDS_PATH}/${document.data.id}`)
        .send(document);
    },
  );

  app.post(
    '/connect/consent-records/:id/withdraw',
    {
      config: { scopes: ['connect-share-tokens:write'] },
      schema: {
        summary: 'Withdraw a consent record',
        description:
          'C237.1, C237.2: `withdrawn-via: api`, with an optional `withdrawal-reason`; its ' +
          '`created` token expires (`consent_withdrawn`), a `pending` one fails at commit, and a ' +
          'redeemed share is announced to the counterparty. 409 `consent_already_withdrawn`.',
        tags: TAGS,
        params: consentRecordParamsSchema,
        body: withdrawConsentRecordBodySchema,
        response: {
          200: consentRecordDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) =>
      withdrawConsentRecordAs(deps, actingOf(request), request.params.id, {
        via: 'api',
        reason: request.body.data.attributes['withdrawal-reason'] ?? null,
      }),
  );

  done();
};
