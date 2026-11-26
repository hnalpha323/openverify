/**
 * The committed OpenAPI snapshot (`docs/api/openapi.json`). `openapi.test.ts` compares the
 * served document with it; `pnpm --filter @openverify/api openapi:write` rewrites it.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { format, resolveConfig } from 'prettier';

export const OPENAPI_SNAPSHOT_PATH = fileURLToPath(
  new URL('../../../../docs/api/openapi.json', import.meta.url),
);

/**
 * One text per document content and key order, whatever its layout: what `openapi.test.ts`
 * compares, so the check never formats the 8 MB document (Prettier only writes it).
 */
export function compactOpenApi(text: string): string {
  return JSON.stringify(JSON.parse(text));
}

/** Set by `openapi:write`: `openapi.test.ts` then writes the formatted document instead of comparing. */
export const OPENAPI_WRITE_ENV = 'OPENVERIFY_OPENAPI_WRITE';

/** `/openapi.json` of `app`, formatted with the repository's Prettier settings. */
export async function renderOpenApiDocument(app: Pick<FastifyInstance, 'inject'>): Promise<string> {
  const response = await app.inject({ url: '/openapi.json' });
  if (response.statusCode !== 200) {
    throw new Error(`/openapi.json answered ${String(response.statusCode)}: ${response.body}`);
  }
  const options = (await resolveConfig(OPENAPI_SNAPSHOT_PATH)) ?? {};
  return format(response.body, { ...options, parser: 'json' });
}
