// @vitest-environment node
/**
 * C157.1, C157.2, C174.7 (Workflow 9A, flow-server-embed): what the flow server sends for each entry,
 * starting from Phase 7's hosted headers (`FLOW_RESPONSE_HEADERS`, C107.9) with a test for every
 * header an entry changes; the id check; the client address; the arguments and the configuration.
 * Every origin is a reserved name and every value is synthetic.
 */
import { isId } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  clientAddress,
  embedHeaders,
  FlowServerConfigError,
  frameAncestorsDirective,
  hostedHeaders,
  isInquiryId,
  parseFlowServerArgs,
  previewHeaders,
  readFlowServerConfig,
} from '../../server.ts';
import { buildContentSecurityPolicy } from '../security/csp-policy';
import { FLOW_RESPONSE_HEADERS } from '../security/response-headers';

const API = 'https://api.example.com';
const CONSOLE = 'https://console.example.com';
const TOKEN = 'synthetic-flow-server-token-current-0123456789';
const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';

/** The directives of a policy, by name. */
function directives(policy: string | undefined): Map<string, string> {
  return new Map(
    (policy ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => {
        const [name = '', ...values] = part.split(/\s+/);
        return [name, values.join(' ')];
      }),
  );
}

describe("the hosted entry's headers (C157.1)", () => {
  const headers = hostedHeaders({ apiOrigin: API });

  it("sends the flow's policy as a header with frame-ancestors 'none' (changed from frame-ancestors alone)", () => {
    expect(headers['Content-Security-Policy']).toBe(
      `${buildContentSecurityPolicy({ apiOrigin: API })}; frame-ancestors 'none'`,
    );
    expect(directives(headers['Content-Security-Policy']).get('connect-src')).toBe(`'self' ${API}`);
  });

  it('adds X-Frame-Options: DENY for browsers that ignore CSP, and no-store for the document', () => {
    expect(FLOW_RESPONSE_HEADERS['X-Frame-Options']).toBeUndefined();
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Cache-Control']).toBe('no-store');
  });

  it("keeps Phase 7's Permissions-Policy, Referrer-Policy and nosniff unchanged", () => {
    for (const name of ['Permissions-Policy', 'Referrer-Policy', 'X-Content-Type-Options']) {
      expect(headers[name], name).toBe(FLOW_RESPONSE_HEADERS[name]);
    }
  });
});

describe("the embed entry's headers (C157.1, C158)", () => {
  it("sends the hosted policy with frame-ancestors set to the inquiry's origins", () => {
    const headers = embedHeaders({ apiOrigin: API }, [
      'https://shop.example.com',
      'https://*.example.org:8443',
    ]);

    expect(headers['Content-Security-Policy']).toBe(
      `${buildContentSecurityPolicy({ apiOrigin: API })}; frame-ancestors https://shop.example.com https://*.example.org:8443`,
    );
    expect(headers['X-Frame-Options']).toBeUndefined();
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Permissions-Policy']).toBe(FLOW_RESPONSE_HEADERS['Permissions-Policy']);
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it("fails closed to 'none' for an empty list", () => {
    expect(
      directives(embedHeaders({ apiOrigin: null }, [])['Content-Security-Policy']).get(
        'frame-ancestors',
      ),
    ).toBe("'none'");
  });

  it('never lets a value outside the origin grammar reach the header', () => {
    expect(frameAncestorsDirective(['https://shop.example.com'])).toBe(
      'frame-ancestors https://shop.example.com',
    );
    for (const hostile of [
      "https://shop.example.com; script-src 'unsafe-inline'",
      'https://shop.example.com\r\nSet-Cookie: x=1',
      '*',
      "'self'",
      'https://user@shop.example.com',
    ]) {
      expect(frameAncestorsDirective(['https://ok.example.com', hostile]), hostile).toBe(
        "frame-ancestors 'none'",
      );
    }
  });
});

describe("the preview entry's headers (C156.3, C157.1)", () => {
  it('sends the preview policy with frame-ancestors the console origin only, and connect-src none', () => {
    const headers = previewHeaders({ consoleOrigin: CONSOLE });

    expect(headers['Content-Security-Policy']).toBe(
      `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; frame-ancestors ${CONSOLE}; base-uri 'none'; form-action 'none'`,
    );
  });

  it('denies the camera, microphone and geolocation (changed from camera=(self))', () => {
    expect(previewHeaders({ consoleOrigin: CONSOLE })['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
  });

  it("fails closed to frame-ancestors 'none' without a console origin", () => {
    expect(
      directives(previewHeaders({ consoleOrigin: null })['Content-Security-Policy']).get(
        'frame-ancestors',
      ),
    ).toBe("'none'");
  });

  it('keeps Referrer-Policy and nosniff, sends no X-Frame-Options and stores nothing', () => {
    const headers = previewHeaders({ consoleOrigin: CONSOLE });
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBeUndefined();
    expect(headers['Cache-Control']).toBe('no-store');
  });
});

describe('isInquiryId (C157.1; the flow server imports no package index, V04)', () => {
  it("agrees with the contracts' isId('inq', ...) on every vector", () => {
    for (const value of [
      INQUIRY_ID,
      'inq_7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
      'inq_8ZZZZZZZZZZZZZZZZZZZZZZZZZ',
      'inq_01M5CJXHG07XPHF3HRM6NREDHI',
      'inq_01m5cjxhg07xphf3hrm6nredh7',
      'itmpl_01M5CJXHG07XPHF3HRM6NREDH7',
      `${INQUIRY_ID}x`,
      `${INQUIRY_ID}/`,
      '../../etc/passwd',
      '',
      'inq_',
    ]) {
      expect(isInquiryId(value), value).toBe(isId('inq', value));
    }
  });
});

describe('clientAddress (C157.2: OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS)', () => {
  it('believes no X-Forwarded-For with 0 hops', () => {
    expect(clientAddress('198.51.100.7', '203.0.113.9', 0)).toBe('198.51.100.7');
  });

  it('takes the address the trusted hops appended', () => {
    expect(clientAddress('10.0.0.2', '203.0.113.9, 198.51.100.20', 1)).toBe('198.51.100.20');
    expect(clientAddress('10.0.0.2', ['203.0.113.9', '198.51.100.20'], 2)).toBe('203.0.113.9');
  });

  it('stops at the farthest address when there are fewer than the hops', () => {
    expect(clientAddress('10.0.0.2', '203.0.113.9', 5)).toBe('203.0.113.9');
    expect(clientAddress('10.0.0.2', undefined, 1)).toBe('10.0.0.2');
  });

  it('reads an IPv4-mapped IPv6 socket address as IPv4', () => {
    expect(clientAddress('::ffff:198.51.100.7', undefined, 0)).toBe('198.51.100.7');
    expect(clientAddress(undefined, undefined, 0)).toBe('unknown');
  });
});

describe('parseFlowServerArgs', () => {
  it('defaults to a loopback server on the port vite preview used', () => {
    expect(parseFlowServerArgs([])).toEqual({
      help: false,
      hostname: '127.0.0.1',
      port: 4173,
      dist: null,
    });
  });

  it('reads --hostname, --port, --dist and --help, after a forwarded --', () => {
    expect(
      parseFlowServerArgs(['--', '--hostname', '0.0.0.0', '--port', '5173', '--dist', '/tmp/x']),
    ).toEqual({ help: false, hostname: '0.0.0.0', port: 5173, dist: '/tmp/x' });
    expect(parseFlowServerArgs(['--help']).help).toBe(true);
  });

  it('refuses an unknown option and a port outside 1-65535', () => {
    expect(() => parseFlowServerArgs(['--nope'])).toThrow();
    expect(() => parseFlowServerArgs(['--port', '0'])).toThrow(/--port/);
    expect(() => parseFlowServerArgs(['--port', '70000'])).toThrow(/--port/);
  });
});

describe('readFlowServerConfig (C174.7)', () => {
  const base = {
    VITE_OPENVERIFY_API_URL: `${API}/`,
    OPENVERIFY_DASHBOARD_PUBLIC_URL: `${CONSOLE}/console`,
    OPENVERIFY_FLOW_SERVER_TOKEN: TOKEN,
    OPENVERIFY_FLOW_SERVER_API_URL: 'http://api:3000/',
    OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS: '1',
  };

  const issuesOf = (env: Record<string, string | undefined>): readonly string[] => {
    try {
      readFlowServerConfig(env, '/srv/dist');
    } catch (error) {
      if (error instanceof FlowServerConfigError) {
        return error.issues;
      }
      throw error;
    }
    return [];
  };

  it('reads the origins, the lookup and the hops', () => {
    expect(readFlowServerConfig(base, '/srv/dist')).toEqual({
      distDir: '/srv/dist',
      apiOrigin: API,
      // C257.1 (Phase 11, Workflow 11C): the base URL /config.json serves.
      apiBaseUrl: API,
      consoleOrigin: CONSOLE,
      lookup: { apiUrl: 'http://api:3000', token: TOKEN },
      trustedProxyHops: 1,
      hstsMaxAge: 0,
    });
  });

  it('serves without a lookup when the token is unset (every embed answers none)', () => {
    const config = readFlowServerConfig(
      {
        ...base,
        OPENVERIFY_FLOW_SERVER_TOKEN: undefined,
        OPENVERIFY_FLOW_SERVER_API_URL: undefined,
      },
      '/srv/dist',
    );
    expect(config.lookup).toBeNull();
    expect(readFlowServerConfig({}, '/srv/dist')).toMatchObject({
      apiOrigin: null,
      consoleOrigin: null,
      lookup: null,
      trustedProxyHops: 0,
    });
  });

  it('refuses a short token, a placeholder in production and a token without the API URL, never printing the token', () => {
    expect(issuesOf({ ...base, OPENVERIFY_FLOW_SERVER_TOKEN: 'too-short' })).toContainEqual(
      expect.stringMatching(/^OPENVERIFY_FLOW_SERVER_TOKEN: .*32 bytes/),
    );
    const placeholder = 'change-me-flow-server-token-at-least-32-bytes';
    const issues = issuesOf({
      ...base,
      OPENVERIFY_MODE: 'production',
      OPENVERIFY_FLOW_SERVER_TOKEN: placeholder,
    });
    expect(issues).toContainEqual(
      expect.stringMatching(/^OPENVERIFY_FLOW_SERVER_TOKEN: .*placeholder/),
    );
    expect(issues.join('\n')).not.toContain(placeholder);
    expect(issuesOf({ ...base, OPENVERIFY_FLOW_SERVER_API_URL: undefined })).toContainEqual(
      expect.stringMatching(/^OPENVERIFY_FLOW_SERVER_API_URL: /),
    );
  });

  it('refuses malformed URLs and hops', () => {
    expect(issuesOf({ ...base, OPENVERIFY_DASHBOARD_PUBLIC_URL: 'console' })).toContainEqual(
      expect.stringMatching(/^OPENVERIFY_DASHBOARD_PUBLIC_URL: /),
    );
    expect(issuesOf({ ...base, OPENVERIFY_FLOW_SERVER_API_URL: 'ftp://api' })).toContainEqual(
      expect.stringMatching(/^OPENVERIFY_FLOW_SERVER_API_URL: /),
    );
    expect(issuesOf({ ...base, VITE_OPENVERIFY_API_URL: 'nope' })).toContainEqual(
      expect.stringMatching(/^VITE_OPENVERIFY_API_URL: /),
    );
    for (const hops of ['-1', '33', '1.5', 'two']) {
      expect(
        issuesOf({ ...base, OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS: hops }),
        hops,
      ).toContainEqual(expect.stringMatching(/^OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS: /));
    }
  });
});
