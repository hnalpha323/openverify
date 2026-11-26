/**
 * The disposable-email list of C56 (`disposable_email_blocklist.conf` at `6fcca80`, CC0, pinned
 * in `data/manifest.json` and fetched by `scripts/fetch_data.py`) and how an address's domain is
 * matched against it and the template's `allow-domains` and `deny-domains`. No public-suffix list
 * is used (its data is MPL-2.0): the domain and each parent down to two labels are looked up, the
 * most specific match deciding.
 *
 * `api-otp` loads the file once (`parseDisposableDomainList`) and passes the set to the check.
 */

/** How a domain matched: the operator allowed or denied it, or the list names it. */
export interface DisposableDomainMatch {
  kind: 'allowed' | 'denied' | 'listed';
  /** How many labels above the address's own domain the match is (0: the domain itself). */
  depth: number;
}

/** The lists a domain is matched against; `listed` is `null` without the list file. */
export interface DisposableDomainLists {
  listed: ReadonlySet<string> | null;
  allow: readonly string[];
  deny: readonly string[];
}

/**
 * Parses the list file: one domain per line, trimmed and lower-cased; blank lines and lines
 * starting with `#` are skipped, and so is any line that is not a host name with a dot.
 */
export function parseDisposableDomainList(text: string): ReadonlySet<string> {
  const domains = new Set<string>();
  for (const line of text.split('\n')) {
    const domain = line.trim().toLowerCase();
    if (domain !== '' && !domain.startsWith('#') && isHostWithDot(domain)) {
      domains.add(domain);
    }
  }
  return domains;
}

/**
 * The most specific match of `domain` (lower-case ASCII) and its parents: at each level the
 * operator's lists first, then the file; `null` when nothing matched.
 */
export function matchDisposableDomain(
  domain: string,
  lists: DisposableDomainLists,
): DisposableDomainMatch | null {
  const labels = domain.split('.');
  for (let depth = 0; labels.length - depth >= 2; depth += 1) {
    const candidate = labels.slice(depth).join('.');
    if (lists.deny.includes(candidate)) {
      return { kind: 'denied', depth };
    }
    if (lists.allow.includes(candidate)) {
      return { kind: 'allowed', depth };
    }
    if (lists.listed?.has(candidate) === true) {
      return { kind: 'listed', depth };
    }
  }
  return null;
}

/** An RFC 1123 label: letters, digits and inner hyphens, 1 to 63 characters. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LDH_LABEL = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u;

function isHostWithDot(domain: string): boolean {
  const labels = domain.split('.');
  return (
    domain.length <= 253 && labels.length >= 2 && labels.every((label) => LDH_LABEL.test(label))
  );
}
