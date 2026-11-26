/**
 * C162.7 (Workflow 9A): a template's translations, as JSON (public) and as CSV (ours), under
 * `/api/v1`. `GET` reads the latest draft, else the latest published version; `POST` imports rows
 * partially into the draft (creating one from the latest published version), never publishes, and a
 * blank value deletes nothing. The CSV is read by `readCsv` (at most 2 MiB and 20,000 rows) and
 * written by the formula-neutralising writer; an import problem names its row and column, never a
 * value. Each import counts the `translations-import` policy per environment first (C174.4). Frozen
 * by `foundation-9a` (Stage 1b (T)); `api-templates` owns this file and builds it.
 */
import {
  idSchema,
  importTranslationsBodySchema,
  inquiryTemplateTranslationsDocumentSchema,
  TRANSLATIONS_CSV_LIMITS,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  importTranslations,
  importTranslationsCsv,
  readTranslations,
  translationsCsv,
} from '../../services/templates/translations.js';
import { actingOf } from './inquiries.js';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { enforceRoutePolicy } from '../../plugins/rate-limit.js';
import type { ApiDependencies } from '../../services/context.js';

const TAGS = ['inquiry-templates'];
const params = z.object({ id: idSchema('itmpl') });
/** The CSV body's parsed form: its bytes, read by `readCsv`. */
const csvBody = z.instanceof(Buffer).meta({ description: 'The translations as `text/csv`.' });

export const inquiryTemplateTranslationRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'buffer', bodyLimit: TRANSLATIONS_CSV_LIMITS.bytes },
    (_request, body, parsed) => {
      parsed(null, body);
    },
  );
  const importPolicy = (environmentId: string) =>
    enforceRoutePolicy(
      deps.rateLimiter,
      'translations-import',
      environmentId,
      'Too many translation imports in this environment; retry later.',
    );

  app.get(
    '/inquiry-templates/:id/translations',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: "Read a template's translations",
        description:
          'C162.7: every translatable text of the latest draft, else the latest published version, ' +
          'with its step, component, attribute and the value in each locale.',
        tags: TAGS,
        params,
        response: {
          200: inquiryTemplateTranslationsDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => readTranslations(deps, requirePrincipal(request).environmentId, request.params.id),
  );

  app.post(
    '/inquiry-templates/:id/translations',
    {
      config: { scopes: ['inquiry-templates:write'] },
      schema: {
        summary: "Import a template's translations",
        description:
          'C162.7: the rows are imported partially into the draft (one is created from the latest ' +
          'published version when none exists); nothing is published, and a blank value deletes ' +
          'nothing. Counted by the `translations-import` policy.',
        tags: TAGS,
        params,
        body: importTranslationsBodySchema,
        response: {
          200: inquiryTemplateTranslationsDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422, 429),
        },
      },
    },
    async (request) => {
      await importPolicy(requirePrincipal(request).environmentId);
      return importTranslations(
        deps,
        actingOf(request),
        request.params.id,
        request.body.data.attributes.translations,
      );
    },
  );

  app.get(
    '/inquiry-templates/:id/translations.csv',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: "Download a template's translations as CSV",
        description:
          'C162.7 (ours): `step,component,attribute,<locale>…`, one row per text, every cell ' +
          'neutralised against formula injection.',
        tags: TAGS,
        params,
        response: {
          200: {
            description: 'The translations as CSV.',
            content: { 'text/csv': { schema: z.string() } },
          },
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      const csv = await translationsCsv(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
      );
      return reply.type('text/csv; charset=utf-8').send(csv);
    },
  );

  app.post(
    '/inquiry-templates/:id/translations.csv',
    {
      config: { scopes: ['inquiry-templates:write'] },
      bodyLimit: TRANSLATIONS_CSV_LIMITS.bytes,
      schema: {
        summary: "Import a template's translations from CSV",
        description:
          'C162.7 (ours): the CSV the download writes, at most 2 MiB and 20,000 rows, imported as the ' +
          'JSON rows are; a problem names its row and column, never a value. Counted by the ' +
          '`translations-import` policy.',
        tags: TAGS,
        params,
        body: csvBody,
        response: {
          200: inquiryTemplateTranslationsDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 413, 415, 422, 429),
        },
      },
    },
    async (request) => {
      await importPolicy(requirePrincipal(request).environmentId);
      return importTranslationsCsv(deps, actingOf(request), request.params.id, request.body);
    },
  );

  done();
};
