/**
 * `POST /csp-reports` (C170.2): the console's violation report endpoint. Public, because
 * browsers often send reports without the session cookie, so every rule here holds for anyone:
 *
 * - only `application/csp-report` (`report-uri`) and `application/reports+json` (`report-to`);
 * - at most 16 KiB, refused from the declared length before reading and while streaming;
 * - at most 60 reports a minute per client address (each report of a batch counts), the address
 *   taken through the console's own helpers, never a raw `X-Forwarded-For`;
 * - one warn line per violation with the effective directive and the blocked resource's scheme
 *   and host only: never the document, the referrer, a path or a query, which can hold ids or
 *   a person's data.
 */

/** What one logged violation holds. */
export interface CspViolationLogEntry {
  readonly level: 'warn';
  readonly msg: 'csp-violation';
  readonly 'effective-directive': string;
  readonly 'blocked-origin': string;
}

export interface CspReportHandlerDependencies {
  /** The client's address through the existing helpers, or `null` when unknown. */
  readonly clientAddress: (request: Request) => Promise<string | null>;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
  readonly log: (entry: CspViolationLogEntry) => void;
}

/** Provisional, C170.2: a report is a few hundred bytes; a batch of them fits. */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;
/** Provisional, C170.2: one page that breaks the policy reports a handful per load. */
export const CSP_REPORTS_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
/** Provisional (DS4): the addresses held in one minute; a new one past them is refused. */
const MAX_TRACKED_ADDRESSES = 10_000;
const UNKNOWN_ADDRESS = 'unknown';

const MEDIA_TYPES = new Set(['application/csp-report', 'application/reports+json']);
/** The `blocked-uri` keywords browsers send instead of a URL. */
const BLOCKED_KEYWORDS = new Set([
  'inline',
  'eval',
  'wasm-eval',
  'self',
  'trusted-types-policy',
  'trusted-types-sink',
]);
const DIRECTIVE = /^[a-z][a-z-]{0,39}$/;
const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

const empty = (status: number, headers?: Record<string, string>) =>
  new Response(null, { status, ...(headers === undefined ? {} : { headers }) });

/** The body as text, or `null` once it passes the cap; reading stops there. */
async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (declared > CSP_REPORT_MAX_BYTES) {
    return null;
  }
  if (request.body === null) {
    return '';
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > CSP_REPORT_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function blockedOrigin(value: unknown): string {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  if (BLOCKED_KEYWORDS.has(value)) {
    return value;
  }
  if (!URL.canParse(value)) {
    return 'unknown';
  }
  const url = new URL(value);
  return NETWORK_SCHEMES.has(url.protocol) ? `${url.protocol}//${url.host}` : url.protocol;
}

function directiveOf(value: unknown): string {
  return typeof value === 'string' && DIRECTIVE.test(value) ? value : 'unknown';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function entry(directive: unknown, blocked: unknown): CspViolationLogEntry {
  return {
    level: 'warn',
    msg: 'csp-violation',
    'effective-directive': directiveOf(directive),
    'blocked-origin': blockedOrigin(blocked),
  };
}

/** The violations of a parsed body, or `null` when its shape is not a report of that type. */
function violationsOf(mediaType: string, body: unknown): CspViolationLogEntry[] | null {
  if (mediaType === 'application/csp-report') {
    const report = isRecord(body) ? body['csp-report'] : undefined;
    if (!isRecord(report)) {
      return null;
    }
    return [
      entry(report['effective-directive'] ?? report['violated-directive'], report['blocked-uri']),
    ];
  }
  if (!Array.isArray(body)) {
    return null;
  }
  const violations: CspViolationLogEntry[] = [];
  for (const report of body) {
    if (isRecord(report) && report.type === 'csp-violation' && isRecord(report.body)) {
      violations.push(entry(report.body.effectiveDirective, report.body.blockedURL));
    }
  }
  return violations;
}

/**
 * A fixed one-minute window per address, at most `MAX_TRACKED_ADDRESSES` of them (DS4; R001). The
 * map keeps its windows in the order they started (a renewed window moves to the end), so the
 * expired ones are always at its front and each call sweeps only those: the work per report stays
 * constant however many addresses send. A new address past the cap is refused until a window
 * expires, so memory stays bounded; an address already held keeps its own count.
 */
class ReportLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();

  /** Takes one report from `address`; `false` once the minute's 60 are used, or the map is full. */
  take(address: string, now: number): boolean {
    for (const [key, window] of this.#windows) {
      if (now - window.start < WINDOW_MS) {
        break;
      }
      this.#windows.delete(key);
    }
    const current = this.#windows.get(address);
    if (current === undefined || now - current.start >= WINDOW_MS) {
      if (current === undefined && this.#windows.size >= MAX_TRACKED_ADDRESSES) {
        return false;
      }
      this.#windows.delete(address);
      this.#windows.set(address, { start: now, count: 1 });
      return true;
    }
    if (current.count >= CSP_REPORTS_PER_MINUTE) {
      return false;
    }
    current.count += 1;
    return true;
  }
}

function mediaTypeOf(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

/** The route handler of `POST /csp-reports`, with its own limiter. */
export function createCspReportHandler(
  dependencies: CspReportHandlerDependencies,
): (request: Request) => Promise<Response> {
  const limiter = new ReportLimiter();
  return async (request) => {
    const mediaType = mediaTypeOf(request);
    if (!MEDIA_TYPES.has(mediaType)) {
      return empty(415);
    }
    const text = await readCapped(request);
    if (text === null) {
      return empty(413);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return empty(400);
    }
    const violations = violationsOf(mediaType, body);
    if (violations === null) {
      return empty(400);
    }
    const address = (await dependencies.clientAddress(request)) ?? UNKNOWN_ADDRESS;
    const now = dependencies.now();
    for (const violation of violations) {
      if (!limiter.take(address, now)) {
        return empty(429, { 'retry-after': String(WINDOW_MS / 1000) });
      }
      dependencies.log(violation);
    }
    return empty(204);
  };
}
