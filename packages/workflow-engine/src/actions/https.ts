/**
 * Make HTTPS Request (plan C124.1, C124.3, C124.4, C124.5): the contract of the one step that reaches
 * an arbitrary host. What this schema refuses is what the stored definition itself gets wrong: a host
 * a value could choose, a header OpenVerify owns, a body on a method that has none. What the guard
 * refuses (addresses, ports past the policy, redirects, response types) is `api-egress`'s, on the
 * rendered request, and `pii_in_url` and the secret placements are publish rules.
 *
 * C115.2: only a path segment or a query value may hold a template, each percent-encoded by the sink,
 * so end-user data never becomes a DNS label.
 */
import {
  hasSecretReference,
  workflowDeclaredNameSchema,
  workflowSecretReferenceSchema,
  workflowTypeSchema,
} from '@openverify/contracts';
import { z } from 'zod';
import { actionValueSchema, personal, plain, provisional } from './common.js';

const KIB = 1024;
const NOTE = 'docs/research/phase8-actions-sandbox.md';

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** C124, decision 44: every one provisional, ours. */
export const HTTPS_ACTION_LIMITS = Object.freeze({
  'timeout-seconds': provisional(10, 'C124.1'),
  'timeout-seconds-ceiling': provisional(30, 'C124.1'),
  'url-bytes': provisional(2 * KIB, 'ours: the longest URL common servers accept'),
  headers: provisional(32, 'C124.1'),
  'header-bytes': provisional(8 * KIB, 'C124.1'),
  'body-bytes': provisional(256 * KIB, 'C124.1'),
  'response-bytes': provisional(KIB * KIB, 'C124.5'),
  'response-depth': provisional(32, `${NOTE}: as Evaluate Code's output`),
  'error-body-bytes': provisional(16 * KIB, 'C124.5'),
  'response-members': provisional(32, 'C113.4: the cap on declared names'),
  'requests-per-minute': provisional(600, 'decision 44'),
  'host-concurrency': provisional(5, 'decision 44'),
});

/** C124.1: the public methods. */
export const HTTPS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpsMethod = (typeof HTTPS_METHODS)[number];
const METHODS_WITH_A_BODY: ReadonlySet<HttpsMethod> = new Set(['POST', 'PUT', 'PATCH']);

const TEMPLATE = /\{\{[^{}]*\}\}/g;

/**
 * `https://<literal host>[:<literal port>]`, then the rest of the URL. The host takes whatever a
 * host can be, an IDN or an IPv6 literal included, because `normalizeHost()` and the guard read it;
 * a credential, a template or a backslash stops the match.
 */
const LITERAL_ORIGIN =
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  /^https:\/\/([^\s/?#@:{}[\]\\]+|\[[0-9a-f:.]+\])(?::(\d{1,5}))?(?=[/?]|$)(.*)$/is;

function literalParts(url: string): { host: string; rest: string } | null {
  const match = LITERAL_ORIGIN.exec(url);
  const [, host, , rest] = match ?? [];
  return host === undefined ? null : { host, rest: rest ?? '' };
}

/** A template stands for a value only: never a query name, and never in a fragment. */
function templatesFitTheirPlaces(rest: string): boolean {
  const queryAt = rest.indexOf('?');
  if (queryAt === -1) {
    return true;
  }
  return rest
    .slice(queryAt + 1)
    .split('&')
    .every((pair) => !pair.split('=', 1).join('').includes('{{'));
}

function urlProblem(url: string): string | null {
  if (utf8Bytes(url) > HTTPS_ACTION_LIMITS['url-bytes'].value) {
    return 'must be at most 2 KiB';
  }
  if (hasSecretReference(url)) {
    return 'a secret never goes in a URL';
  }
  const parts = literalParts(url);
  if (parts === null) {
    return 'the scheme, host and port must be literal, on https';
  }
  const literal = url.replace(TEMPLATE, 'x');
  if (/[\s#]/.test(literal)) {
    return 'must hold no space and no fragment';
  }
  if (!URL.canParse(literal) || !templatesFitTheirPlaces(parts.rest)) {
    return 'a template fills a path segment or a query value';
  }
  return null;
}

/**
 * C124.3: the literal host of a published URL, for the allowlist and the secret's `allowed_hosts`.
 * `null` for a URL that has none. Compared through `normalizeHost()`, never as text.
 */
export function httpsLiteralHost(url: string): string | null {
  return literalParts(url)?.host ?? null;
}

const urlSchema = z.string().superRefine((url, context) => {
  const problem = urlProblem(url);
  if (problem !== null) {
    context.addIssue({ code: 'custom', message: problem });
  }
});

const REFUSED_HOP_BY_HOP = [
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'expect',
  'te',
  'trailer',
] as const;

const OWNED_BY_OPENVERIFY = [
  'openverify-request-signature',
  'openverify-signature',
  'idempotency-key',
  'openverify-workflow-run',
] as const;

/** C124.4: and every `proxy-*`. */
export const WORKFLOW_HTTP_REFUSED_HEADERS: readonly string[] = Object.freeze([
  ...REFUSED_HOP_BY_HOP,
  ...OWNED_BY_OPENVERIFY,
]);

const REFUSED: ReadonlySet<string> = new Set(WORKFLOW_HTTP_REFUSED_HEADERS);

/** The HTTP token syntax (RFC 9110). */
const HEADER_NAME = /^[!#$%&'*+.^\w`|~-]+$/;
const CONTROL_IN_VALUE = /[\r\n\0]/;

const headerNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(HEADER_NAME, 'must be an HTTP token')
  .refine((name) => {
    const lower = name.toLowerCase();
    return !REFUSED.has(lower) && !lower.startsWith('proxy-');
  }, 'this header is OpenVerify’s or the connection’s');

const headersSchema = z
  .array(
    z.strictObject({
      name: headerNameSchema,
      value: z.string().refine((value) => !CONTROL_IN_VALUE.test(value), 'no CR, LF or NUL'),
    }),
  )
  .max(HTTPS_ACTION_LIMITS.headers.value)
  .refine(
    (headers) =>
      headers.reduce((total, { name, value }) => total + utf8Bytes(name) + utf8Bytes(value), 0) <=
      HTTPS_ACTION_LIMITS['header-bytes'].value,
    'must be at most 8 KiB',
  )
  .refine(
    (headers) => new Set(headers.map(({ name }) => name.toLowerCase())).size === headers.length,
    'names each header once',
  );

/**
 * C124.1: a member of the response body, with a PII mark that has no default: only a member declared
 * non-PII leaves taint behind (C115.6).
 */
const responseMemberSchema = z.strictObject({
  name: workflowDeclaredNameSchema,
  type: workflowTypeSchema,
  pii: z.boolean(),
});

/** A step's `retry` is the definition's (C113.2), so it is not repeated in this config. */
export const makeHttpsRequestConfigSchema = z
  .strictObject({
    method: z.enum(HTTPS_METHODS),
    url: urlSchema,
    headers: headersSchema.optional(),
    /** A C115 value template, serialised once by the sink. */
    body: actionValueSchema.optional(),
    'response-schema': z
      .array(responseMemberSchema)
      .max(HTTPS_ACTION_LIMITS['response-members'].value)
      .optional(),
    'timeout-seconds': z
      .int()
      .min(1)
      .max(HTTPS_ACTION_LIMITS['timeout-seconds-ceiling'].value)
      .default(HTTPS_ACTION_LIMITS['timeout-seconds'].value),
    /** C124.6: a workflow secret only, never a webhook secret. */
    signing: z.strictObject({ secret: workflowSecretReferenceSchema }).optional(),
    /** Ours (C124.5): a non-2xx comes back with no body otherwise. */
    'capture-error-body': z.boolean().optional(),
  })
  .refine(({ body, method }) => body === undefined || METHODS_WITH_A_BODY.has(method), {
    message: 'only POST, PUT and PATCH carry a body',
    path: ['body'],
  })
  .refine(
    ({ body }) =>
      body === undefined ||
      utf8Bytes(JSON.stringify(body)) <= HTTPS_ACTION_LIMITS['body-bytes'].value,
    { message: 'must be at most 256 KiB', path: ['body'] },
  );
export type MakeHttpsRequestConfig = z.infer<typeof makeHttpsRequestConfigSchema>;

/**
 * C124.1, C124.5: a status is a status, and the headers are the four the plan allows. The body is
 * PII whole, because only a declared schema can say otherwise, and those marks are the step's.
 */
export const makeHttpsRequestOutputSchema = z.strictObject({
  status: plain(z.int().min(100).max(599)),
  headers: personal(
    z.strictObject({
      'content-type': z.string().optional(),
      location: z.string().optional(),
      'retry-after': z.string().optional(),
      etag: z.string().optional(),
    }),
  ),
  body: personal(actionValueSchema.nullable()),
});
export type MakeHttpsRequestOutput = z.infer<typeof makeHttpsRequestOutputSchema>;
