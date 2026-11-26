// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CSP_MODE_ENV,
  CSP_NONCE_HEADER,
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
  FLOW_PUBLIC_URL_ENV,
  REPORTING_ENDPOINTS,
  consoleCsp,
  createNonce,
  cspHeaderName,
  cspMode,
  flowPublicOrigin,
} from './policy';

/** Next.js reads the nonce of the request's policy with this pattern (`get-script-nonce-from-header`). */
const NEXT_NONCE_SOURCE = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

describe('consoleCsp (C170.1)', () => {
  it('is exactly the plan policy, with the nonce in script-src and style-src and the flow origin in frame-src', () => {
    expect(
      consoleCsp({
        nonce: 'bm9uY2Utc3ludGhldGljMQ==',
        flowOrigin: 'https://flow.example.com',
        development: false,
      }),
    ).toBe(
      "default-src 'self'; " +
        "script-src 'self' 'nonce-bm9uY2Utc3ludGhldGljMQ==' 'strict-dynamic'; " +
        "style-src 'self' 'nonce-bm9uY2Utc3ludGhldGljMQ=='; " +
        "img-src 'self' blob: data:; " +
        "font-src 'self'; " +
        "connect-src 'self'; " +
        'frame-src https://flow.example.com; ' +
        "worker-src 'none'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'; " +
        'report-uri /csp-reports; ' +
        'report-to csp',
    );
  });

  it("adds 'unsafe-eval' to script-src in development only, and nothing else", () => {
    const options = { nonce: 'bm9uY2Utc3ludGhldGljMg==', flowOrigin: 'http://127.0.0.1:5173' };
    const production = consoleCsp({ ...options, development: false });
    const development = consoleCsp({ ...options, development: true });

    expect(production).not.toContain('unsafe');
    expect(development).toBe(
      production.replace("'strict-dynamic';", "'strict-dynamic' 'unsafe-eval';"),
    );
  });

  it("frames nothing when no flow origin is configured: frame-src 'none', never a wildcard", () => {
    expect(
      consoleCsp({ nonce: 'bm9uY2Utc3ludGhldGljMw==', flowOrigin: null, development: false }),
    ).toContain("; frame-src 'none'; ");
  });

  it("keeps frame-ancestors 'none' beside next.config.ts's static header (C170.4)", () => {
    expect(
      consoleCsp({ nonce: 'bm9uY2Utc3ludGhldGljNA==', flowOrigin: null, development: true }),
    ).toContain("frame-ancestors 'none'");
  });

  it('names the report endpoint both ways, and Reporting-Endpoints maps the group to it', () => {
    expect(CSP_REPORT_PATH).toBe('/csp-reports');
    expect(CSP_REPORT_GROUP).toBe('csp');
    expect(REPORTING_ENDPOINTS).toBe('csp="/csp-reports"');
  });
});

describe('createNonce', () => {
  it('is 128 random bits in base64, which Next.js reads from the policy', () => {
    const nonce = createNonce();

    expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
    expect(NEXT_NONCE_SOURCE.exec(`'nonce-${nonce}'`)?.[1]).toBe(nonce);
  });

  it('is fresh on every call', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => createNonce()));

    expect(nonces.size).toBe(200);
  });

  it('travels to the render in the x-nonce request header', () => {
    expect(CSP_NONCE_HEADER).toBe('x-nonce');
  });
});

describe('cspMode (OPENVERIFY_DASHBOARD_CSP_MODE)', () => {
  it('enforces by default', () => {
    expect(CSP_MODE_ENV).toBe('OPENVERIFY_DASHBOARD_CSP_MODE');
    expect(cspMode({})).toBe('enforce');
    expect(cspMode({ [CSP_MODE_ENV]: '' })).toBe('enforce');
    expect(cspMode({ [CSP_MODE_ENV]: 'enforce' })).toBe('enforce');
  });

  it('reports only when asked exactly, around whitespace', () => {
    expect(cspMode({ [CSP_MODE_ENV]: 'report-only' })).toBe('report-only');
    expect(cspMode({ [CSP_MODE_ENV]: ' report-only\n' })).toBe('report-only');
  });

  it.each(['report_only', 'Report-Only', 'off', 'none'])(
    'enforces for the unknown value %j: a typo never switches the policy off',
    (value) => {
      expect(cspMode({ [CSP_MODE_ENV]: value })).toBe('enforce');
    },
  );

  it('sends the report-only header only in report-only mode', () => {
    expect(cspHeaderName('enforce')).toBe('Content-Security-Policy');
    expect(cspHeaderName('report-only')).toBe('Content-Security-Policy-Report-Only');
  });
});

describe('flowPublicOrigin', () => {
  it('reads OPENVERIFY_FLOW_PUBLIC_URL as an origin', () => {
    expect(FLOW_PUBLIC_URL_ENV).toBe('OPENVERIFY_FLOW_PUBLIC_URL');
    expect(flowPublicOrigin({ [FLOW_PUBLIC_URL_ENV]: 'http://127.0.0.1:5173' })).toBe(
      'http://127.0.0.1:5173',
    );
    expect(flowPublicOrigin({ [FLOW_PUBLIC_URL_ENV]: ' https://Flow.Example.com/start/ ' })).toBe(
      'https://flow.example.com',
    );
  });

  it.each([
    undefined,
    '',
    'not a url',
    'ftp://flow.example.com',
    'javascript:alert(1)',
    'https://user:synthetic-password@flow.example.com',
    'https://flow.example.com/?a=1',
    'https://flow.example.com/#x',
  ])('is null for %j: no origin rather than a wrong one', (value) => {
    expect(flowPublicOrigin({ [FLOW_PUBLIC_URL_ENV]: value })).toBeNull();
  });
});

describe('the console reads no public origin of its own (K9-13)', () => {
  it('exports no reader of OPENVERIFY_DASHBOARD_PUBLIC_URL: the preview compares the flow origin with window.location.origin, and the compose dashboard is never given it', async () => {
    const policy: Readonly<Record<string, unknown>> = await import('./policy');

    expect(Object.keys(policy)).not.toContain('consolePublicOrigin');
    expect(Object.keys(policy)).not.toContain('DASHBOARD_PUBLIC_URL_ENV');
  });
});
