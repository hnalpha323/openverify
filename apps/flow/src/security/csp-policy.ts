/**
 * C157.1, C158.1 (Workflow 9A Stage 1b (F); reviews F10, F11, F12): the flow's Content-Security-Policy
 * and its API base URL, in one module with no import at all, so both the Vite build
 * (`vite.config.ts`, through `security-meta.ts`) and the flow server (`server.ts`, run by Node's type
 * stripping from source) compute the same policy from the same `VITE_OPENVERIFY_API_URL`. Keep it
 * import-free and erasable: an import here would have to resolve under Vite and under Node alike.
 */

export interface ContentSecurityPolicyOptions {
  /** Extra origin the flow calls (the API), or `null` when it is the flow's own origin. */
  readonly apiOrigin: string | null;
}

/** The hosted flow's policy as one header or `<meta>` value (without `frame-ancestors`). */
export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const connect = options.apiOrigin === null ? "'self'" : `'self' ${options.apiOrigin}`;
  return [
    "default-src 'self'",
    // The face guidance compiles onnxruntime-web's WebAssembly, served from this origin (C46.1).
    "script-src 'self' 'wasm-unsafe-eval'",
    `connect-src ${connect}`,
    // Previews of captured or chosen photos are blob: URLs.
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    // No form in the flow is ever submitted natively; every submit is handled in script.
    "form-action 'none'",
  ].join('; ');
}

/**
 * `VITE_OPENVERIFY_API_URL`: where the OpenVerify API is served, for example
 * `https://api.example.com` or `https://example.com/openverify`. Empty or unset means the API
 * shares the flow's origin. It is read at build time, both for the client and for the
 * Content-Security-Policy `connect-src`.
 */
function parse(value: string | undefined): URL | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TypeError('VITE_OPENVERIFY_API_URL must be an absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('VITE_OPENVERIFY_API_URL must use http or https');
  }
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new TypeError('VITE_OPENVERIFY_API_URL must not carry a query, fragment or credentials');
  }
  return url;
}

/**
 * Normalises the API base URL: no trailing slash, `''` when unset (same origin).
 * @throws {TypeError} when the value is not an absolute http(s) URL without query, fragment
 * or credentials.
 */
export function parseApiBaseUrl(value: string | undefined): string {
  const url = parse(value);
  return url === null ? '' : `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * The origin the flow must be allowed to connect to, or `null` for the same origin.
 * @throws {TypeError} for an invalid value (see `parseApiBaseUrl`).
 */
export function apiOrigin(value: string | undefined): string | null {
  return parse(value)?.origin ?? null;
}
