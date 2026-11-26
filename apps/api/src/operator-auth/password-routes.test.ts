/**
 * C245.3 (Phase 11, Workflow 11B, auth-sessions; amendment 4): "changes or resets its password" ends
 * every session of the user, and today no route changes or resets a password: a password is set
 * only when an invitation is accepted, and read only by the sign-in. This test holds that, from the
 * OpenAPI document, so the day a route that takes a password is added it fails here until that
 * route ends the user's other sessions (and this list names it).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type Schema = Record<string, unknown>;
interface OpenApiDocument {
  paths: Record<
    string,
    Partial<
      Record<
        (typeof HTTP_METHODS)[number],
        { requestBody?: { content?: Record<string, { schema?: Schema }> } }
      >
    >
  >;
  components?: { schemas?: Record<string, Schema> };
}

const openapi = JSON.parse(
  readFileSync(new URL('../../../../docs/api/openapi.json', import.meta.url), 'utf8'),
) as OpenApiDocument;

/** Every member name of `schema`, through `$ref`s, compositions and arrays. */
function memberNames(schema: Schema | undefined, depth = 0): Set<string> {
  const names = new Set<string>();
  if (schema === undefined || depth > 16) {
    return names;
  }
  if (typeof schema.$ref === 'string') {
    return memberNames(
      openapi.components?.schemas?.[schema.$ref.split('/').at(-1) ?? ''],
      depth + 1,
    );
  }
  for (const [name, member] of Object.entries(
    (schema.properties ?? {}) as Record<string, Schema>,
  )) {
    names.add(name);
    for (const nested of memberNames(member, depth + 1)) names.add(nested);
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    for (const part of (schema[key] ?? []) as Schema[]) {
      for (const nested of memberNames(part, depth + 1)) names.add(nested);
    }
  }
  for (const nested of memberNames(schema.items as Schema | undefined, depth + 1))
    names.add(nested);
  return names;
}

/** The operations whose path or request body names a password. */
function passwordOperations(): string[] {
  const found: string[] = [];
  for (const [path, operations] of Object.entries(openapi.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = operations[method];
      if (operation === undefined) {
        continue;
      }
      const members = new Set<string>();
      for (const { schema } of Object.values(operation.requestBody?.content ?? {})) {
        for (const name of memberNames(schema)) members.add(name);
      }
      const named = [...members].some((name) => name.toLowerCase().includes('password'));
      if (named || path.toLowerCase().includes('password')) {
        found.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return found.sort();
}

describe('C245.3: no route changes or resets a password (amendment 4)', () => {
  it('takes a password only at sign-in and when an invitation is accepted', () => {
    expect(passwordOperations()).toEqual([
      // The first password, set once; the invited user has no session yet.
      'POST /api/v1/dashboard/invitations/accept',
      // The C4 sign-in reads it.
      'POST /api/v1/dashboard/sessions',
    ]);
  });
});
