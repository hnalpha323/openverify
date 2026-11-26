import type { HtmlTagDescriptor, IndexHtmlTransformHook } from 'vite';
import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, securityMetaPlugin } from './security-meta';

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );
}

function transformHook(apiUrl: string | undefined): IndexHtmlTransformHook {
  const plugin = securityMetaPlugin({ apiUrl });
  const hook = plugin.transformIndexHtml;
  if (typeof hook !== 'function') {
    throw new TypeError('expected a transformIndexHtml function');
  }
  return hook;
}

async function metaTags(apiUrl: string | undefined): Promise<HtmlTagDescriptor[]> {
  const result = await transformHook(apiUrl).call(
    // The hook does not use its plugin context.
    undefined as never,
    '<html><head></head><body></body></html>',
    { path: '/index.html', filename: 'index.html' },
  );
  if (!Array.isArray(result)) {
    throw new TypeError('expected tag descriptors');
  }
  return result;
}

describe('buildContentSecurityPolicy', () => {
  it('locks everything to the flow’s own origin by default', () => {
    const policy = directives(buildContentSecurityPolicy({ apiOrigin: null }));

    expect(Object.fromEntries(policy)).toEqual({
      'default-src': "'self'",
      'script-src': "'self' 'wasm-unsafe-eval'",
      'connect-src': "'self'",
      'img-src': "'self' blob: data:",
      'media-src': "'self' blob:",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
    });
  });

  it('lets the flow call the API origin', () => {
    const policy = directives(buildContentSecurityPolicy({ apiOrigin: 'https://api.example.com' }));

    expect(policy.get('connect-src')).toBe("'self' https://api.example.com");
    expect(policy.get('default-src')).toBe("'self'");
  });

  it('never allows inline or evaluated scripts', () => {
    const tokens = buildContentSecurityPolicy({ apiOrigin: 'https://api.example.com' }).split(
      /[\s;]+/,
    );

    expect(tokens).not.toContain("'unsafe-inline'");
    expect(tokens).not.toContain("'unsafe-eval'");
  });

  it('lets the guidance compile its WebAssembly from the flow’s own origin, and nothing else (C46.1)', () => {
    const policy = directives(buildContentSecurityPolicy({ apiOrigin: 'https://api.example.com' }));

    expect(policy.get('script-src')).toBe("'self' 'wasm-unsafe-eval'");
    expect(policy.has('worker-src')).toBe(false);
  });
});

describe('securityMetaPlugin', () => {
  it('only runs for production builds', () => {
    expect(securityMetaPlugin({ apiUrl: undefined })).toMatchObject({
      name: 'openverify:security-meta',
      apply: 'build',
    });
  });

  it('prepends the CSP meta tag to the head', async () => {
    const tags = await metaTags('https://api.example.com/v');

    expect(tags).toEqual([
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: buildContentSecurityPolicy({ apiOrigin: 'https://api.example.com' }),
        },
        injectTo: 'head-prepend',
      },
    ]);
  });

  // C257.1 (Phase 11, Workflow 11C, images-11c; decision 73): a bundle built without the variable
  // (the image) learns the API's origin at run time, from the flow server, which sends the exact
  // origin in its connect-src header. Two policies intersect, so the <meta> must not narrow
  // connect-src: it keeps every other directive and allows any http(s) origin (default-src 'self'
  // would otherwise govern connections), and the header decides.
  it.each([undefined, '', '  '])(
    'leaves connect-src to the flow server when no API URL is set at build (%j)',
    async (apiUrl) => {
      const [tag] = await metaTags(apiUrl);
      const meta = directives(String(tag?.attrs?.content));
      const hosted = directives(buildContentSecurityPolicy({ apiOrigin: null }));

      expect(meta.get('connect-src')).toBe("'self' https: http:");
      hosted.delete('connect-src');
      meta.delete('connect-src');
      expect(Object.fromEntries(meta)).toEqual(Object.fromEntries(hosted));
    },
  );

  it('fails the build for an invalid API URL', () => {
    expect(() => securityMetaPlugin({ apiUrl: 'ftp://api.example.com' })).toThrow(TypeError);
  });
});
