import { NFC_PREFILL_MRZ_MEMBER } from '@openverify/contracts';
import type { FastifyLoggerOptions, FastifyRequest, FastifyServerOptions } from 'fastify';

/** Fastify's logger options object (Fastify options plus pino options such as `redact`). */
export type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

export const REDACTED = '[REDACTED]';

const CREDENTIAL_HEADERS = ['authorization', 'cookie', '["proxy-authorization"]', '["set-cookie"]'];
const headerPaths = (prefix: string): string[] =>
  CREDENTIAL_HEADERS.map((header) =>
    header.startsWith('[') ? `${prefix}headers${header}` : `${prefix}headers.${header}`,
  );

/**
 * C53.8: the specific names Phase 5 code may log personal data under, besides `pii`: an OTP code
 * or destination, a challenge or signed message, entered values, a wallet address, a chip file and
 * an Active Authentication response. No generic name (`code`, `message`, `values`, `destination`,
 * `inputs`) is redacted, so a logged error keeps its message and code. The Phase 5 lint rule
 * (`@openverify/config/eslint-phase5`) allows exactly these.
 */
export const PERSONAL_LOG_KEYS = Object.freeze([
  'otpCode',
  'otpDestination',
  'challengeMessage',
  'signedMessage',
  'inputValues',
  'walletAddress',
  'chipFile',
  'aaResponse',
  // Phase 6 (Workflow 6A Stage 1b): a report's screened query, a matched or listed name, an
  // article title, and the re-screen's subject index.
  'reportQuery',
  'matchedName',
  'listEntryName',
  'articleTitle',
  'subjectIndex',
]);

/**
 * Log paths pino replaces with `[REDACTED]`. Credentials are covered wherever headers are
 * logged. Any field named `pii`, up to five levels deep, is redacted whole, so code that
 * must log personal data nests it under a `pii` key.
 */
export const REDACT_PATHS: readonly string[] = [
  ...headerPaths('req.'),
  ...headerPaths('res.'),
  ...headerPaths(''),
  ...headerPaths('*.'),
  'pii',
  '*.pii',
  '*.*.pii',
  '*.*.*.pii',
  '*.*.*.*.pii',
  // C53.8: the specific Phase 5 names, never a generic one.
  ...PERSONAL_LOG_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  // C207.2, C221.1 (Workflow 10C, api-nfc): the nfc client view's MRZ key fields, wherever a
  // logged object carries a flow session's `step` (`step`, `body.step`, `res.body.step`).
  ...['', '*.', '*.*.', '*.*.*.'].map((prefix) => `${prefix}${NFC_PREFILL_MRZ_MEMBER}`),
];

/**
 * C93.7 (P06, Workflow 7A): what a request log line says about the request: its method and the
 * route pattern it matched (`null` when none matched), with the request id Fastify adds beside it.
 * Fastify's default serializer logged the full URL (with its path values and query), the host and
 * the client's address and port on every request; none of them is logged any more.
 */
export function serializeRequest(request: Pick<FastifyRequest, 'method' | 'routeOptions'>): {
  method: string;
  route: string | null;
} {
  return { method: request.method, route: request.routeOptions.url ?? null };
}

export interface LoggerSettings {
  level?: string;
  /** Where log lines go (defaults to stdout). Tests pass an in-memory stream. */
  stream?: FastifyLoggerOptions['stream'];
}

/** Fastify logger options with PII redaction; `false` disables logging. */
export function loggerOptions(settings: LoggerSettings | false = {}): LoggerOptions | false {
  if (settings === false) {
    return false;
  }
  return {
    level: settings.level ?? 'info',
    ...(settings.stream === undefined ? {} : { stream: settings.stream }),
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    serializers: { req: serializeRequest },
  };
}
