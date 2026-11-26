// @vitest-environment node
/**
 * C255.4 (Workflow 11B, integration-11b): every state-changing console entry point checks the
 * request's origin. The enumeration is generated from the tree, so a new handler or server action
 * fails here until it is classified:
 *
 * - Route handlers (`src/app/**\/route.ts`): every exported POST, PUT, PATCH or DELETE refuses a
 *   cross-origin request with 403 before it reads the session or the body (`Origin` equal to the
 *   console's host, or `Sec-Fetch-Site: same-origin` when the browser sends `Origin: null` under the
 *   console's `Referrer-Policy: no-referrer`), proved here by calling each with a foreign origin. The
 *   CSP report sink is the one POST without the check: browsers send reports from any page with no
 *   credentials, and it stores nothing but a counted, redacted log line. Every GET handler is listed
 *   with what it does: reads, plus the three that set or clear a cookie by design (the SSO start and
 *   callback, which the provider's redirect reaches cross-site and the state, nonce and browser
 *   binding protect, C248.4; the signed-out page, which clears a cookie the API already refused).
 * - Server actions (every `'use server'` file): Next.js refuses an action whose `Origin` is not the
 *   console's host. That counts only where a test proves it: `e2e/tests/hardening-11b.spec.ts` posts
 *   an action with a foreign `Origin` to the real console and is refused, while the same call from
 *   the console's origin is not; here, `next.config.ts` never widens it (no
 *   `serverActions.allowedOrigins`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const APP = join(SRC, 'app');

function files(directory: string, match: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') found.push(...files(path, match));
    } else if (match(entry)) {
      found.push(path);
    }
  }
  return found;
}

const handlers = files(APP, (name) => name === 'route.ts').map((path) => relative(APP, path));
const methodsOf = (path: string): string[] => {
  const source = readFileSync(join(APP, path), 'utf8');
  return [
    ...source.matchAll(/export (?:async function|const|function) (GET|POST|PUT|PATCH|DELETE)\b/g),
  ].map((match) => match[1] ?? '');
};

/** The state-changing handlers with the origin check, and how to reach each with a valid id. */
const CHECKED_WRITES: Readonly<Record<string, { url: string; params: Record<string, string> }>> = {
  'cases/[id]/attachments/route.ts': {
    url: '/cases/case_01M5CN0000000000000011A100/attachments',
    params: { id: 'case_01M5CN0000000000000011A100' },
  },
  'exports/bulk-reports/upload/route.ts': { url: '/exports/bulk-reports/upload', params: {} },
  'graph/[id]/export/route.ts': {
    url: '/graph/grphq_01M5CN0000000000000011A100/export',
    params: { id: 'grphq_01M5CN0000000000000011A100' },
  },
  'templates/[id]/translations/csv/route.ts': {
    url: '/templates/itmpl_01M5CN0000000000000011A100/translations/csv',
    params: { id: 'itmpl_01M5CN0000000000000011A100' },
  },
};
/** The one POST without the check, with its reason (above). */
const UNCHECKED_WRITES: ReadonlySet<string> = new Set(['csp-reports/route.ts']);
/** GET handlers that set or clear a cookie by design (above); every other GET only reads. */
const COOKIE_GETS: ReadonlySet<string> = new Set([
  '(auth)/sso/[slug]/start/route.ts',
  '(auth)/sso/start/route.ts',
  '(auth)/sso/callback/[provider]/route.ts',
  'login/signed-out/route.ts',
]);
const READ_GETS: ReadonlySet<string> = new Set([
  'cases/[id]/attachments/[attachmentId]/content/route.ts',
  'cases/exports/[id]/download/route.ts',
  'exports/[id]/download/route.ts',
  'exports/saved-views/route.ts',
  'files/[id]/content/route.ts',
  'files/[id]/rendition/route.ts',
  'lists/importers/[id]/errors.csv/route.ts',
  'templates/[id]/preview/assets/[assetId]/route.ts',
  'templates/[id]/translations/csv/route.ts',
  'theme-sets/assets/[id]/content/route.ts',
  'transactions/[id]/files/[fileId]/content/route.ts',
]);

describe('the origin check on every state-changing route handler (C255.4)', () => {
  it('classifies every handler and method: a new one fails until it is', () => {
    const unclassified: string[] = [];
    for (const path of handlers) {
      for (const method of methodsOf(path)) {
        const known =
          method === 'GET'
            ? READ_GETS.has(path) || COOKIE_GETS.has(path)
            : CHECKED_WRITES[path] !== undefined || UNCHECKED_WRITES.has(path);
        if (!known) unclassified.push(`${method} ${path}`);
      }
    }
    expect(unclassified).toEqual([]);
    expect(handlers.length).toBeGreaterThanOrEqual(19);
  });

  it.each(Object.entries(CHECKED_WRITES))(
    'POST %s refuses a foreign origin with 403, and Origin: null without Sec-Fetch-Site',
    async (path, { url, params }) => {
      const module = (await import(`../app/${path.replace(/\.ts$/, '')}`)) as {
        POST: (
          request: Request,
          context: { params: Promise<Record<string, string>> },
        ) => Promise<Response>;
      };
      for (const headers of [
        { origin: 'https://attacker.example.org', 'sec-fetch-site': 'cross-site' },
        { origin: 'null', 'sec-fetch-site': 'cross-site' },
      ]) {
        const response = await module.POST(
          new Request(`http://dashboard.test${url}`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'multipart/form-data; boundary=x' },
            body: '--x--',
          }),
          { params: Promise.resolve(params) },
        );
        expect(response.status, `${path} with ${headers.origin}`).toBe(403);
      }
    },
  );
});

describe('server actions (C255.4)', () => {
  const actions = files(SRC, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).filter(
    (path) => /^\s*['"]use server['"]/m.test(readFileSync(path, 'utf8')),
  );

  it('finds the console’s server-action modules', () => {
    expect(actions.length).toBeGreaterThanOrEqual(46);
  });

  it('never widens Next.js’s own origin check (no serverActions.allowedOrigins)', () => {
    const nextConfig = readFileSync(
      fileURLToPath(new URL('../../next.config.ts', import.meta.url)),
      'utf8',
    );
    expect(nextConfig).not.toMatch(/allowedOrigins/);
  });
});
