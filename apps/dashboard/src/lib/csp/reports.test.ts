// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CSP_REPORTS_PER_MINUTE,
  CSP_REPORT_MAX_BYTES,
  createCspReportHandler,
  type CspViolationLogEntry,
} from './reports';

const URL_OF = 'http://dashboard.test/csp-reports';
const ADDRESS = '203.0.113.7';

/** A legacy `report-uri` body (application/csp-report), with the members that must never be logged. */
function legacyReport(members: Record<string, unknown> = {}): string {
  return JSON.stringify({
    'csp-report': {
      'document-uri': 'https://dashboard.test/inquiries/inq_synthetic?filter=secret',
      referrer: 'https://dashboard.test/accounts?q=private',
      'violated-directive': 'script-src-elem',
      'effective-directive': 'script-src-elem',
      'original-policy': "default-src 'self'",
      'blocked-uri': 'https://evil.example.org:8443/x.js?token=synthetic-leak',
      'status-code': 200,
      ...members,
    },
  });
}

/** A Reporting API body (application/reports+json): an array of reports of several types. */
function reportingApiBody(
  bodies: readonly Record<string, unknown>[],
  type = 'csp-violation',
): string {
  return JSON.stringify(
    bodies.map((body) => ({
      type,
      age: 10,
      url: 'https://dashboard.test/users?filter[email]=someone@example.com',
      user_agent: 'synthetic',
      body: {
        documentURL: 'https://dashboard.test/users?filter[email]=someone@example.com',
        referrer: 'https://dashboard.test/',
        disposition: 'enforce',
        ...body,
      },
    })),
  );
}

function post(body: string | ReadableStream<Uint8Array>, contentType: string, headers = {}) {
  return new Request(URL_OF, {
    method: 'POST',
    headers: { 'content-type': contentType, ...headers },
    body,
    ...(typeof body === 'string' ? {} : { duplex: 'half' }),
  });
}

let logged: CspViolationLogEntry[];
let now: number;
let address: string | null;
let handle: (request: Request) => Promise<Response>;

beforeEach(() => {
  logged = [];
  now = Date.UTC(2026, 10, 7, 12, 0, 0);
  address = ADDRESS;
  handle = createCspReportHandler({
    clientAddress: () => Promise.resolve(address),
    now: () => now,
    log: (entry) => logged.push(entry),
  });
});

describe('POST /csp-reports (C170.2)', () => {
  it('accepts a report-uri report and logs only the effective directive and the blocked scheme and host', async () => {
    const response = await handle(post(legacyReport(), 'application/csp-report'));

    expect(response.status).toBe(204);
    expect(logged).toEqual([
      {
        level: 'warn',
        msg: 'csp-violation',
        'effective-directive': 'script-src-elem',
        'blocked-origin': 'https://evil.example.org:8443',
      },
    ]);
    const line = JSON.stringify(logged);
    for (const never of [
      'inquiries',
      'secret',
      'accounts',
      'private',
      'x.js',
      'token',
      'synthetic-leak',
      'default-src',
    ]) {
      expect(line).not.toContain(never);
    }
  });

  it('accepts a Reporting API batch, logging each csp-violation and nothing of another type', async () => {
    const response = await handle(
      post(
        reportingApiBody([
          { effectiveDirective: 'style-src-attr', blockedURL: 'inline' },
          { effectiveDirective: 'img-src', blockedURL: 'http://cdn.example.com/a.png?x=1' },
        ]),
        'application/reports+json',
      ),
    );
    await handle(
      post(
        reportingApiBody([{ effectiveDirective: 'x' }], 'deprecation'),
        'application/reports+json',
      ),
    );

    expect(response.status).toBe(204);
    expect(logged).toEqual([
      {
        level: 'warn',
        msg: 'csp-violation',
        'effective-directive': 'style-src-attr',
        'blocked-origin': 'inline',
      },
      {
        level: 'warn',
        msg: 'csp-violation',
        'effective-directive': 'img-src',
        'blocked-origin': 'http://cdn.example.com',
      },
    ]);
    expect(JSON.stringify(logged)).not.toContain('someone@example.com');
  });

  it('accepts a media type with parameters, in any case', async () => {
    const response = await handle(post(legacyReport(), 'Application/CSP-Report; charset=utf-8'));

    expect(response.status).toBe(204);
    expect(logged).toHaveLength(1);
  });

  it.each(['application/json', 'text/plain', 'multipart/form-data; boundary=x', ''])(
    'refuses the content type %j with 415 and logs nothing',
    async (type) => {
      const response = await handle(post(legacyReport(), type));

      expect(response.status).toBe(415);
      expect(logged).toEqual([]);
    },
  );

  it('refuses a body over 16 KiB that declares its length, before reading it', async () => {
    expect(CSP_REPORT_MAX_BYTES).toBe(16_384);
    const body = legacyReport({ padding: 'p'.repeat(CSP_REPORT_MAX_BYTES) });

    const response = await handle(
      post(body, 'application/csp-report', { 'content-length': String(body.length) }),
    );

    expect(response.status).toBe(413);
    expect(logged).toEqual([]);
  });

  it('refuses a streamed body that passes 16 KiB without declaring its length', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(4096));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 10) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
    });

    const response = await handle(post(stream, 'application/csp-report'));

    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(10);
    expect(logged).toEqual([]);
  });

  it('accepts a body of exactly 16 KiB', async () => {
    const base = legacyReport({ padding: '' });
    const body = legacyReport({ padding: 'p'.repeat(CSP_REPORT_MAX_BYTES - base.length) });
    expect(body.length).toBe(CSP_REPORT_MAX_BYTES);

    expect((await handle(post(body, 'application/csp-report'))).status).toBe(204);
  });

  it.each(['{', '[]', '"text"', '{"csp-report": 3}', 'null'])(
    'answers 400 to the malformed report %j and logs nothing',
    async (body) => {
      const response = await handle(post(body, 'application/csp-report'));

      expect(response.status).toBe(400);
      expect(logged).toEqual([]);
    },
  );

  it('answers 400 to a Reporting API body that is not an array', async () => {
    expect((await handle(post('{}', 'application/reports+json'))).status).toBe(400);
  });

  it.each([
    ['inline', 'inline'],
    ['eval', 'eval'],
    ['wasm-eval', 'wasm-eval'],
    ['self', 'self'],
    ['data:image/png;base64,AAAA', 'data:'],
    ['blob:https://dashboard.test/5a3f', 'blob:'],
    ['wss://socket.example.com/path?q', 'wss://socket.example.com'],
    ['not a url at all', 'unknown'],
    ['', 'unknown'],
    [42, 'unknown'],
  ])('logs the blocked value %j as %j', async (blocked, expected) => {
    await handle(post(legacyReport({ 'blocked-uri': blocked }), 'application/csp-report'));

    expect(logged[0]?.['blocked-origin']).toBe(expected);
  });

  it.each([
    ['script-src', 'script-src'],
    ['Script-Src\n injected', 'unknown'],
    ['a'.repeat(41), 'unknown'],
    [null, 'unknown'],
  ])(
    'logs the directive %j as %j, so a report cannot write into the log',
    async (directive, expected) => {
      await handle(
        post(
          legacyReport({ 'effective-directive': directive, 'violated-directive': directive }),
          'application/csp-report',
        ),
      );

      expect(logged[0]?.['effective-directive']).toBe(expected);
    },
  );

  it('falls back to violated-directive when a legacy report has no effective-directive', async () => {
    const body = JSON.stringify({
      'csp-report': { 'violated-directive': 'frame-src', 'blocked-uri': 'https://x.example.com/' },
    });

    await handle(post(body, 'application/csp-report'));

    expect(logged[0]?.['effective-directive']).toBe('frame-src');
  });

  it('takes 60 reports a minute from one client address, then answers 429 and logs nothing more', async () => {
    expect(CSP_REPORTS_PER_MINUTE).toBe(60);
    for (let index = 0; index < 60; index += 1) {
      expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(204);
    }

    const refused = await handle(post(legacyReport(), 'application/csp-report'));

    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('60');
    expect(logged).toHaveLength(60);
  });

  it('counts each report of a batch, so one request cannot log more than the limit', async () => {
    // Minimal reports, so 70 of them stay under the 16 KiB cap.
    const batch = JSON.stringify(
      Array.from({ length: 70 }, () => ({
        type: 'csp-violation',
        body: { effectiveDirective: 'img-src', blockedURL: 'data:' },
      })),
    );
    expect(batch.length).toBeLessThan(CSP_REPORT_MAX_BYTES);

    const response = await handle(post(batch, 'application/reports+json'));

    expect(response.status).toBe(429);
    expect(logged).toHaveLength(60);
  });

  it('keeps one limit per address and resets it after a minute', async () => {
    for (let index = 0; index < 60; index += 1) {
      await handle(post(legacyReport(), 'application/csp-report'));
    }
    address = '198.51.100.20';
    expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(204);

    address = ADDRESS;
    now += 59_999;
    expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(429);
    now += 1;
    expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(204);
  });

  it('puts clients whose address is unknown into one shared limit', async () => {
    address = null;
    for (let index = 0; index < 60; index += 1) {
      await handle(post(legacyReport(), 'application/csp-report'));
    }

    expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(429);
  });

  it('holds at most 10,000 addresses in a minute: a new one past them is refused, a held one still counts (R001)', async () => {
    for (let index = 0; index < 10_000; index += 1) {
      address = `2001:db8::${index.toString(16)}`;
      expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(204);
    }

    address = '2001:db8::1:0';
    const refused = await handle(post(legacyReport(), 'application/csp-report'));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('60');
    address = '2001:db8::0';
    expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(204);
    now += 60_000;
    address = '2001:db8::1:0';
    expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(204);
  });

  it('forgets addresses whose minute has passed once it holds many, so memory stays bounded', async () => {
    for (let index = 0; index < 10_050; index += 1) {
      address = `2001:db8::${index.toString(16)}`;
      await handle(post(legacyReport(), 'application/csp-report'));
    }
    now += 60_000;
    address = '2001:db8::ffff:1';

    expect((await handle(post(legacyReport(), 'application/csp-report'))).status).toBe(204);
  });
});
