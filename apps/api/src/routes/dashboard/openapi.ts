import type { SwaggerTransform } from '@fastify/swagger';
import { createJsonSchemaTransform } from 'fastify-type-provider-zod';
import { openApiComponents } from '../../plugins/openapi.js';

/** OpenAPI tag of every C4 operation. */
export const DASHBOARD_TAG = 'dashboard';

/** The security scheme C4 operations reference (`components.securitySchemes`). */
export const USER_SESSION_SECURITY_SCHEME = Object.freeze({
  userSession: Object.freeze({
    type: 'http',
    scheme: 'bearer',
    description: 'Dashboard user session token sent as "Authorization: Bearer <ovu_...>".',
  }),
});

/** `security` of every C4 operation except login. */
export const USER_SESSION_SECURITY = [{ userSession: [] }];

/** The app's zod conversion, with the contract schemas named as shared components. */
const zodTransform = createJsonSchemaTransform({ schemaRegistry: openApiComponents });

interface DocumentWithComponents {
  components?: { securitySchemes?: Record<string, unknown> };
}

interface TransformedResponses {
  response?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

/**
 * Image and PDF responses are raw bytes. Their zod schema (`z.instanceof(Buffer)`) has no JSON
 * Schema form, so the document states it directly: a binary string.
 */
function documentFilesAsBinary(schema: TransformedResponses): void {
  for (const response of Object.values(schema.response ?? {})) {
    for (const [mediaType, media] of Object.entries(response.content ?? {})) {
      if (mediaType.startsWith('image/') || mediaType === 'application/pdf') {
        media.schema = { type: 'string', format: 'binary' };
      }
    }
  }
}

/**
 * The `swaggerTransform` of every dashboard route. @fastify/swagger fails on a `security`
 * entry that names an undefined scheme, so this adds `userSession` to the document being
 * built when the app's options do not define it. It assigns a new `securitySchemes` object:
 * the one in the document is shared with the app's swagger options and is never mutated.
 * A route-level transform replaces the app's global one, so it then applies the same zod
 * conversion itself, with the same named components (`openApiComponents`), and marks image and
 * PDF responses as binary.
 */
export const dashboardSwaggerTransform: SwaggerTransform = (document) => {
  if ('openapiObject' in document) {
    const target: DocumentWithComponents = document.openapiObject;
    const components = (target.components ??= {});
    if (components.securitySchemes?.userSession === undefined) {
      components.securitySchemes = {
        ...components.securitySchemes,
        ...USER_SESSION_SECURITY_SCHEME,
      };
    }
  }
  const transformed = zodTransform(document);
  documentFilesAsBinary(transformed.schema as TransformedResponses);
  return transformed;
};
