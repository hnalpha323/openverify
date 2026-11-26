/**
 * C124.3: the one host normaliser. Every allowlist, every `allowed_hosts` and the Slack host are
 * compared through it, always on a parsed URL and never on text: the WHATWG URL host, lower-cased,
 * with a trailing dot removed and an IDN as the URL parser gives it, so a suffix-extended host, a
 * trailing dot, a percent-encoded host or a homograph compares as what it is.
 */

/** The host of a URL as every comparison reads it; `null` for a URL with none. */
export function normalizeHostOf(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return host === '' ? null : host;
}

/** A bare host as text, read by the URL parser; `null` for anything that is not one alone. */
export function normalizeHost(written: string): string | null {
  // A `:`, `/`, `@`, `?`, `#` or `\\` would make the parser read part of it as something else.
  if (written === '' || /[/@?#\\\s]/.test(written) || /(?<!\]):\d*$/.test(written)) {
    return null;
  }
  try {
    return normalizeHostOf(new URL(`https://${written}/`));
  } catch {
    return null;
  }
}

/** Whether `written` is on `list`, each entry read the same way, so neither is compared as text. */
export function hostIsListed(written: string, list: readonly string[]): boolean {
  const host = normalizeHost(written);
  return host !== null && list.some((entry) => normalizeHost(entry) === host);
}
