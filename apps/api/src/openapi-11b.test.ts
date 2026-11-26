/**
 * Workflow 11B (integration-11b): every 11B route is built, so none documents the 501 its frozen
 * schema carried (foundation-11b froze them; the owners built them with the schemas unchanged), and
 * each documents what its built handler answers: the SSO provider removal's 204 (sso-oidc), the UN
 * opt-in's 422 for an acknowledgement of other terms and the withdrawal's 409 while the switch is
 * locked (ingestion-11b). Read from the committed snapshot, which `openapi.test.ts` holds equal to the
 * served document.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Operation {
  description?: string;
  responses: Record<string, unknown>;
}
type Paths = Record<string, Record<string, Operation>>;

const document = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../docs/api/openapi.json', import.meta.url)), 'utf8'),
) as { paths: Paths };

const ELEVEN_B_OPERATIONS: readonly (readonly [string, string])[] = [
  ['post', '/api/v1/accounts/{id}/export'],
  ['get', '/api/v1/account-exports/{id}'],
  ['get', '/api/v1/account-exports/{id}/manifest'],
  ['get', '/api/v1/account-exports/{id}/files/{fileId}'],
  ['get', '/api/v1/dashboard/sso/{organizationSlug}/start'],
  ['get', '/api/v1/dashboard/sso/callback/{providerId}'],
  ['post', '/api/v1/dashboard/sessions/current/step-up/sso'],
  ['get', '/api/v1/dashboard/sso-providers'],
  ['post', '/api/v1/dashboard/sso-providers'],
  ['get', '/api/v1/dashboard/sso-providers/{id}'],
  ['patch', '/api/v1/dashboard/sso-providers/{id}'],
  ['delete', '/api/v1/dashboard/sso-providers/{id}'],
  ['post', '/api/v1/dashboard/users/{id}/end-sessions'],
  ['post', '/api/v1/dashboard/watchlist-sources/{sourceId}/opt-in'],
  ['delete', '/api/v1/dashboard/watchlist-sources/{sourceId}/opt-in'],
  ['get', '/ready'],
];

const responsesOf = (method: string, path: string): string[] =>
  Object.keys(document.paths[path]?.[method]?.responses ?? {});

describe('the 11B routes as built (integration-11b)', () => {
  it.each(ELEVEN_B_OPERATIONS)('%s %s documents no 501', (method, path) => {
    expect(responsesOf(method, path).length).toBeGreaterThan(0);
    expect(responsesOf(method, path)).not.toContain('501');
  });

  it('documents what the built handlers answer', () => {
    expect(responsesOf('delete', '/api/v1/dashboard/sso-providers/{id}')).toContain('204');
    expect(responsesOf('post', '/api/v1/dashboard/watchlist-sources/{sourceId}/opt-in')).toContain(
      '422',
    );
    expect(
      responsesOf('delete', '/api/v1/dashboard/watchlist-sources/{sourceId}/opt-in'),
    ).toContain('409');
  });
});

describe('the UN opt-in after Q10 (integration-11g)', () => {
  it('documents the install switch and its default true, not the locked default of 11B', () => {
    const description =
      document.paths['/api/v1/dashboard/watchlist-sources/{sourceId}/opt-in']?.post?.description ??
      '';
    expect(description).toContain('OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED');
    expect(description).toContain('true by default');
    expect(description).not.toContain('which is its default in this release');
  });
});
