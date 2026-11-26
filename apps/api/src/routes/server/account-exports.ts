/**
 * C253.1 (Workflow 11B; Stage 1a amendments 47 and 48): the access export of one account.
 *
 * - `POST /api/v1/accounts/:id/export`: 202 with the export `pending`; 409
 *   `account_export_pending`, 422 `account_export_too_large`, 503 `account_export_unavailable` (the
 *   `account-export` policy, 10 an hour per environment, failing closed), 403 `step_up_required`.
 * - `GET /api/v1/account-exports/:id`: the export's counts and times, no personal data.
 * - `GET /api/v1/account-exports/:id/manifest`: the `openverify.account-export.v1` document.
 * - `GET /api/v1/account-exports/:id/files/:fileId`: a listed file's live bytes, never cached; 410
 *   `account_export_item_redacted` once it is redacted; a file the manifest does not list is the
 *   generic 404.
 *
 * Every route needs `account-access:export`, and a user also `pii:view` and Phase 9's step-up.
 *
 * Frozen by `foundation-11b` (Stage 1b (D)) with `contracts-11b`'s schemas; built by `dsar-export`
 * over `services/account-export/service.ts`; integration-11b dropped the frozen 501 with the OpenAPI
 * snapshot, as Workflow 11A's routes did. The create answers the generic
 * 404 for an account outside the caller's environment first (rule 22), then counts the
 * `account-export` policy (`refusals.ts`) before anything else; every refusal of C253.5 and C253.7 is
 * counted by its registered metric, labelled by the environment only; the export is admitted after
 * its commit (`admission.ts`, C251.1).
 */
import {
  accountExportDocumentSchema,
  accountExportFileParamsSchema,
  accountExportManifestSchema,
  accountExportParamsSchema,
  createAccountExportBodySchema,
  idSchema,
} from '@openverify/contracts';
import { getAccount } from '@openverify/db';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '../../errors.js';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { createAccountExportAdmission } from '../../services/account-export/admission.js';
import { readLiveFile } from '../../services/account-export/files.js';
import {
  accountExportRefusalOf,
  countAccountExportRefusal,
  enforceAccountExportRate,
} from '../../services/account-export/refusals.js';
import {
  createAccountExport,
  getAccountExport,
  getAccountExportFile,
  getAccountExportManifest,
  type AccountExportActing,
  type AccountExportDeps,
} from '../../services/account-export/service.js';
import { accountExportStores } from '../../services/account-export/store.js';
import type { ApiDependencies } from '../../services/context.js';
import { actingOf } from './inquiries.js';

const TAGS = ['account-exports'];
const SCOPES = ['account-access:export'] as const;
const accountParams = z.strictObject({ id: idSchema('acc') });
/** The file's bytes, sent unserialized; OpenAPI 3.1 states bytes by the media type alone. */
const binaryContent = z.instanceof(Buffer);

/** The service's dependencies over the API's. */
export function accountExportDepsOf(
  deps: ApiDependencies,
  admit: AccountExportDeps['admit'],
): AccountExportDeps {
  return {
    db: deps.db,
    clock: deps.clock,
    audit: deps.audit,
    storage: deps.storage,
    keyring: deps.keyring,
    ids: deps.ids,
    store: accountExportStores,
    liveFile: readLiveFile,
    admit,
  };
}

const exportActingOf = (request: FastifyRequest): AccountExportActing => ({
  ctx: actingOf(request).ctx,
  principal: requirePrincipal(request),
});

/** C253.1 routes, under `/api/v1`. */
export const accountExportRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  // C251.1: each created export admitted after the commit (`admission.ts`).
  const service = accountExportDepsOf(
    deps,
    createAccountExportAdmission({
      db: deps.db,
      clock: deps.clock,
      producer: deps.accountExports,
      queueInFlightCapMax: deps.queueInFlightCapMax,
    }),
  );
  app.post(
    '/accounts/:id/export',
    {
      config: { scopes: [...SCOPES] },
      schema: {
        summary: 'Export what is held about an account',
        description:
          'C253.1: an access export of everything this install holds through the account’s links ' +
          'at that moment (C253.6), cut by the `account-export` job; 202 with the export ' +
          '`pending`. One pending export per account; at most 5,000 items. 10 an hour per ' +
          'environment (`account-export`), refused while the limiter is unreachable. A user also ' +
          'needs `pii:view` and the step-up.',
        tags: TAGS,
        params: accountParams,
        body: createAccountExportBodySchema,
        response: {
          202: accountExportDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422, 429, 503),
        },
      },
    },
    async (request, reply) => {
      const acting = exportActingOf(request);
      const { environmentId } = acting.ctx;
      // Rule 22: an account the caller cannot see is the one generic 404, whatever the policy's
      // store says, and counts nothing; every other answer follows the policy (C253.7).
      if ((await getAccount(deps.db, environmentId, request.params.id)) === null) {
        throw new NotFoundError(`Account ${request.params.id} was not found.`);
      }
      await enforceAccountExportRate(deps.rateLimiter, request.log, environmentId);
      try {
        const document = await createAccountExport(service, acting, request.params.id);
        return await reply.code(202).send(document);
      } catch (error) {
        const refusal = accountExportRefusalOf(error);
        if (refusal !== null) {
          countAccountExportRefusal(request.log, environmentId, refusal);
        }
        throw error;
      }
    },
  );

  app.get(
    '/account-exports/:id',
    {
      config: { scopes: [...SCOPES] },
      schema: {
        summary: 'Retrieve an account export',
        description:
          'C253.1: the export’s status, counts and times; no personal data. A `ready` export past ' +
          'its `expires-at` reads `expired`.',
        tags: TAGS,
        params: accountExportParamsSchema,
        response: {
          200: accountExportDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => getAccountExport(service, exportActingOf(request), request.params.id),
  );

  app.get(
    '/account-exports/:id/manifest',
    {
      config: { scopes: [...SCOPES] },
      schema: {
        summary: 'Download an account export’s manifest',
        description:
          'C253.2, C253.3: the `openverify.account-export.v1` document of a `ready` export: the ' +
          '`subject` part, the `operator-review` part (review before disclosure), the files it ' +
          'lists and what it does not cover. Audited, never cached, never kept in the API log.',
        tags: TAGS,
        params: accountExportParamsSchema,
        response: {
          200: accountExportManifestSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      const manifest = await getAccountExportManifest(
        service,
        exportActingOf(request),
        request.params.id,
      );
      return reply
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(manifest);
    },
  );

  app.get(
    '/account-exports/:id/files/:fileId',
    {
      config: { scopes: [...SCOPES] },
      schema: {
        summary: 'Download a file an account export lists',
        description:
          'C253.2: the live object of a file the manifest lists, served whole, audited and never ' +
          'cached; 410 once the file is redacted. A file the manifest does not list is not found.',
        tags: TAGS,
        params: accountExportFileParamsSchema,
        response: {
          200: {
            description: 'The file’s bytes, with its media type.',
            content: { 'application/octet-stream': { schema: binaryContent } },
          },
          ...problemResponses(400, 401, 403, 404, 410),
        },
      },
    },
    async (request, reply) => {
      const { bytes, mediaType } = await getAccountExportFile(
        service,
        exportActingOf(request),
        request.params.id,
        request.params.fileId,
      );
      return reply
        .header('content-type', mediaType)
        .header('content-disposition', `attachment; filename="${request.params.fileId}"`)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(bytes);
    },
  );

  done();
};
