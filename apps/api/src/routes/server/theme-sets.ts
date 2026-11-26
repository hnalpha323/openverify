/**
 * C160.1, C160.5, C160.6 (Workflow 9A): the theme set routes under `/api/v1` (`theme-sets:read` and
 * `theme-sets:write`), environment-scoped (decision 24): list, create, retrieve, update, archive,
 * the revisions and restore, the asset upload (multipart, counted by the `theme-assets` policy
 * before anything else) and the operators' asset content. Frozen by `foundation-9a` (Stage 1b (H));
 * built by `api-themes` in Workflow 9B (`services/themes/`), on the frozen schemas.
 */
import {
  THEME_ASSET_FILE_FIELD,
  THEME_ASSET_RESPONSE_HEADERS,
  createThemeSetBodySchema,
  idSchema,
  listThemeSetRevisionsQuerySchema,
  listThemeSetsQuerySchema,
  restoreThemeSetBodySchema,
  themeAssetContentParamsSchema,
  themeAssetDocumentSchema,
  themeSetDocumentSchema,
  themeSetListDocumentSchema,
  themeSetRevisionListDocumentSchema,
  updateThemeSetBodySchema,
} from '@openverify/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { validatorCompiler, type FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { enforceRoutePolicy } from '../../plugins/rate-limit.js';
import { actorOf } from '../../ports.js';
import { serviceContextOf, type ApiDependencies } from '../../services/context.js';
import type { ThemeActing } from '../../services/themes/acting.js';
import {
  readOperatorThemeAsset,
  uploadThemeAsset,
  type ThemeAssetContent,
  type ThemeAssetDeps,
} from '../../services/themes/assets.js';
import {
  archiveThemeSet,
  createThemeSet,
  getThemeSetFor,
  listThemeSetRevisionsFor,
  listThemeSetsFor,
  restoreThemeSet,
  updateThemeSet,
} from '../../services/themes/service.js';

const TAGS = ['theme-sets'];
const params = z.object({ id: idSchema('theset') });
/** C160.6: a 512 KiB font with room for the multipart framing. */
const ASSET_BODY_LIMIT_BYTES = 512 * 1024 + 64 * 1024;

/** The upload's validator: zod for the params; the body is the buffered multipart bytes. */
function multipartBodyValidator(route: {
  schema: unknown;
  method: string;
  url: string;
  httpPart?: string;
}) {
  if (route.httpPart === 'body') {
    return (value: unknown) =>
      value instanceof Uint8Array
        ? { value }
        : { error: new Error('the body must be multipart/form-data') };
  }
  return validatorCompiler({
    schema: route.schema as z.ZodType,
    method: route.method,
    url: route.url,
  });
}

/** Who acts: the principal's tenant, request metadata and audit actor, and its user if any. */
function actingOf(request: FastifyRequest): ThemeActing {
  const principal = requirePrincipal(request);
  return {
    ctx: serviceContextOf(principal, {
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    }),
    actor: actorOf(principal),
    userId: principal.kind === 'user' ? principal.userId : null,
  };
}

/** The asset's bytes with its type and the read's fixed headers (C160.6). */
function sendAsset(
  reply: FastifyReply,
  headers: Readonly<Record<string, string>>,
  content: ThemeAssetContent,
): FastifyReply {
  return reply.headers({ ...headers, 'content-type': content.mediaType }).send(content.bytes);
}

export const themeSetRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, deps) => {
  // C160.6 (review F27): the vision client renders a logo synchronously. `ApiDependencies` has no
  // member for it yet, so a logo is refused as unavailable until one is bound (contractDeviation).
  const assetDeps: ThemeAssetDeps = deps;

  // Local to this plugin: the asset upload's body, buffered as it came.
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: ASSET_BODY_LIMIT_BYTES },
    (_request, body, parsed) => {
      parsed(null, body);
    },
  );

  app.get(
    '/theme-sets',
    {
      config: { scopes: ['theme-sets:read'] },
      schema: {
        summary: 'List theme sets',
        description: 'C160.1: the environment’s theme sets, newest first, by `filter[status]`.',
        tags: TAGS,
        querystring: listThemeSetsQuerySchema,
        response: { 200: themeSetListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listThemeSetsFor(deps, requirePrincipal(request).environmentId, request.query),
  );

  app.post(
    '/theme-sets',
    {
      config: { scopes: ['theme-sets:write'] },
      schema: {
        summary: 'Create a theme set',
        description:
          'C160.1, C160.4: a named styles tree, checked by the contrast gate; audited, revision 1.',
        tags: TAGS,
        body: createThemeSetBodySchema,
        response: {
          201: themeSetDocumentSchema,
          ...problemResponses(400, 401, 403, 422),
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await createThemeSet(deps, actingOf(request), request.body)),
  );

  app.get(
    '/theme-sets/:id',
    {
      config: { scopes: ['theme-sets:read'] },
      schema: {
        summary: 'Retrieve a theme set',
        tags: TAGS,
        params,
        response: { 200: themeSetDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getThemeSetFor(deps, requirePrincipal(request).environmentId, request.params.id),
  );

  app.patch(
    '/theme-sets/:id',
    {
      config: { scopes: ['theme-sets:write'] },
      schema: {
        summary: 'Update a theme set',
        description:
          'C160.1, C160.5: an omitted attribute is unchanged; `styles` replaces the whole tree. Each ' +
          'save writes a revision, live at the next session load.',
        tags: TAGS,
        params,
        body: updateThemeSetBodySchema,
        response: {
          200: themeSetDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    (request) => updateThemeSet(deps, actingOf(request), request.params.id, request.body),
  );

  app.delete(
    '/theme-sets/:id',
    {
      config: { scopes: ['theme-sets:write'] },
      schema: {
        summary: 'Archive a theme set',
        description:
          'C160.7: archives the set, which detaches it; archiving the default answers 409 ' +
          '`theme_set_default`.',
        tags: TAGS,
        params,
        response: {
          200: themeSetDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) => archiveThemeSet(deps, actingOf(request), request.params.id),
  );

  app.get(
    '/theme-sets/:id/revisions',
    {
      config: { scopes: ['theme-sets:read'] },
      schema: {
        summary: 'List a theme set’s revisions',
        description: 'C160.5: newest first, paged by `page[before]` (a revision number).',
        tags: TAGS,
        params,
        querystring: listThemeSetRevisionsQuerySchema,
        response: {
          200: themeSetRevisionListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      listThemeSetRevisionsFor(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
        request.query,
      ),
  );

  app.post(
    '/theme-sets/:id/restore',
    {
      config: { scopes: ['theme-sets:write'] },
      schema: {
        summary: 'Restore a theme set revision',
        description: 'C160.5: `meta.revision` is copied as a new revision; audited.',
        tags: TAGS,
        params,
        body: restoreThemeSetBodySchema,
        response: {
          200: themeSetDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    (request) => restoreThemeSet(deps, actingOf(request), request.params.id, request.body),
  );

  app.post(
    '/theme-sets/assets',
    {
      bodyLimit: ASSET_BODY_LIMIT_BYTES,
      config: { scopes: ['theme-sets:write'] },
      validatorCompiler: multipartBodyValidator,
      schema: {
        summary: 'Upload a theme asset',
        description:
          'C160.6: a logo (PNG, JPEG or WebP by its bytes, at most 256 KiB and 2,048 px, ' +
          're-encoded synchronously) or a WOFF2 font (at most 512 KiB, with ' +
          '`meta[licence-attested]=true`); SVG answers 415. Counted by the `theme-assets` policy.',
        tags: TAGS,
        consumes: ['multipart/form-data'],
        body: z.object({ [THEME_ASSET_FILE_FIELD]: z.string().meta({ format: 'binary' }) }),
        response: {
          201: themeAssetDocumentSchema,
          ...problemResponses(400, 401, 403, 413, 415, 422, 429, 503),
        },
      },
    },
    async (request, reply) => {
      await enforceRoutePolicy(
        deps.rateLimiter,
        'theme-assets',
        requirePrincipal(request).environmentId,
        'Too many theme asset uploads in this environment; retry later.',
      );
      const document = await uploadThemeAsset(assetDeps, actingOf(request), {
        body: request.body as unknown as Uint8Array,
        contentType: request.headers['content-type'] ?? '',
      });
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/theme-sets/assets/:id/content',
    {
      config: { scopes: ['theme-sets:read'] },
      schema: {
        summary: 'Read a theme asset',
        description:
          'C160.6 (review P17): the stored rendition or font, `private, no-store`, as an ' +
          'attachment with `nosniff`, for the theme editor and the preview.',
        tags: TAGS,
        params: themeAssetContentParamsSchema,
        response: {
          200: z.string().meta({ format: 'binary' }).describe('The asset’s stored bytes.'),
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      const content = await readOperatorThemeAsset(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
      );
      return sendAsset(reply, THEME_ASSET_RESPONSE_HEADERS.operator, content);
    },
  );

  return Promise.resolve();
};
