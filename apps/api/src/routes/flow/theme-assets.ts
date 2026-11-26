/**
 * C160.6 (Workflow 9A; built by `api-themes` in Workflow 9B): `GET /api/v1/flow/theme-assets/:id`, a
 * theme asset of the theme the session renders (its logo or its uploaded font) for the flow
 * (`private, max-age=3600`, `nosniff`): a logo shown from a `blob:` URL, a font loaded with
 * `FontFace` from bytes. Any other asset, of this environment or another, is 404, as an unknown
 * one is (R002, Workflow 10A carry-10a).
 */
import { flowThemeAssetParamsSchema, THEME_ASSET_RESPONSE_HEADERS } from '@openverify/contracts';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { readFlowThemeAsset, type ThemeAssetContent } from '../../services/themes/assets.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

/** The asset's bytes with its type and the read's fixed headers (C160.6). */
function sendAsset(
  reply: FastifyReply,
  headers: Readonly<Record<string, string>>,
  content: ThemeAssetContent,
): FastifyReply {
  return reply.headers({ ...headers, 'content-type': content.mediaType }).send(content.bytes);
}

export const themeAssetRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, deps) => {
  // The flow API answers `no-store` from its own onSend hook, which runs first; an asset this
  // plugin served is the one answer cached, privately, for an hour (C160.6). A problem stays
  // `no-store`.
  app.addHook('onSend', async (_request, reply) => {
    if (reply.statusCode === 200) {
      void reply.header('cache-control', THEME_ASSET_RESPONSE_HEADERS.flow['cache-control']);
    }
  });
  app.get(
    '/theme-assets/:id',
    {
      schema: {
        summary: 'Read a theme asset',
        description:
          'C160.6: a logo or font of the theme the session renders, from its own environment.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: flowThemeAssetParamsSchema,
        response: {
          200: z.string().meta({ format: 'binary' }).describe('The asset’s stored bytes.'),
          ...problemResponses(400, 401, 404),
        },
      },
    },
    async (request, reply) => {
      const content = await readFlowThemeAsset(
        deps,
        requireFlowSession(request),
        request.params.id,
      );
      return sendAsset(reply, THEME_ASSET_RESPONSE_HEADERS.flow, content);
    },
  );
  return Promise.resolve();
};
