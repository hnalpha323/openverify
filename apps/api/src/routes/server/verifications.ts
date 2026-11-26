import {
  getVerificationQuerySchema,
  idSchema,
  selfieCaptureDocumentSchema,
  toTimestamp,
  verificationDocumentSchema,
  type VerificationDocument,
} from '@openverify/contracts';
import { getInquiry, listVerificationFiles, type Db } from '@openverify/db';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { piiMaskFor } from '../../auth/pii.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { getSelfieCaptureDocument } from '../../services/selfie-captures.js';
import { fileResource } from '../../services/resources.js';
import { findVerification, getVerificationDocument } from '../../services/verifications.js';

/**
 * C173.2 (Workflow 9B, `api-cases-reports`; K17): when the verification's data was redacted, which
 * happens with its inquiry (C16). Served once it was, and left out before (the member is optional),
 * so an unredacted verification reads the same here as in every other exit (includes, events).
 */
async function withRedactedAt(
  db: Db,
  environmentId: string,
  document: VerificationDocument,
): Promise<VerificationDocument> {
  const inquiry = await getInquiry(db, environmentId, document.data.relationships.inquiry.data.id);
  const redactedAt = inquiry?.redactedAt ?? null;
  if (redactedAt === null) {
    return document;
  }
  return {
    ...document,
    data: {
      ...document.data,
      attributes: { ...document.data.attributes, 'redacted-at': toTimestamp(redactedAt) },
    },
  } as VerificationDocument;
}

/**
 * C173.2 (Workflow 9B, `api-cases-reports`; K17): `include=files`, the verification's file
 * resources in the relationship's order, with their metadata only (the existing file contract).
 */
async function includedFiles(db: Db, environmentId: string, id: string) {
  const verification = await findVerification(db, environmentId, id);
  const files = await listVerificationFiles(db, environmentId, [id]);
  return files.map((file) => fileResource(file, { id, type: verification.type }));
}

/** C2 verification routes, under `/api/v1`. */
export const verificationRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/verifications/:id',
    {
      config: { scopes: ['verifications:read'] },
      schema: {
        summary: 'Fetch a verification with its checks',
        description:
          'A government ID carries its extracted fields and their sources (C31.5). Without ' +
          '`pii:view`, and for an API key minted masked, every extracted value is null; ' +
          '`extraction-sources` names fields only and is always served. A selfie carries ' +
          '`relationships.selfies` (its captures, newest first) and the C40.10 attributes ' +
          '(`capture-method`, `liveness`, `poses` of the consumed capture; the similarity and ' +
          'liveness scores and the centre face box, from the checks, null once redacted); ' +
          '`?include=selfies` adds the captures to `included`.',
        tags: ['verifications'],
        params: z.object({ id: idSchema('ver') }),
        querystring: getVerificationQuerySchema,
        response: {
          200: verificationDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const principal = requirePrincipal(request);
      const { include } = request.query;
      const { environmentId } = principal;
      const document = await getVerificationDocument(
        deps,
        environmentId,
        request.params.id,
        piiMaskFor(principal),
        include === 'selfies' ? include : undefined,
      );
      // C173.2 (Workflow 9B, api-cases-reports): `redacted-at` and `include=files`.
      const withRedaction = await withRedactedAt(deps.db, environmentId, document);
      return include === 'files'
        ? {
            ...withRedaction,
            included: await includedFiles(deps.db, environmentId, request.params.id),
          }
        : withRedaction;
    },
  );

  app.get(
    '/selfies/:id',
    {
      config: { scopes: ['verifications:read'] },
      schema: {
        summary: 'Fetch a selfie capture',
        description:
          'C40.1: status, method, liveness, prompts and prompt timings (the latest file per ' +
          'pose, with the client elapsed time and the server receipt time); never the nonce or ' +
          'any device data.',
        tags: ['verifications'],
        params: z.object({ id: idSchema('self') }),
        response: {
          200: selfieCaptureDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      getSelfieCaptureDocument(deps.db, requirePrincipal(request).environmentId, request.params.id),
  );

  done();
};
