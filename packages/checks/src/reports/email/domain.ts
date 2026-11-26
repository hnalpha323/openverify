/**
 * C82.1: what an email domain is, before any lookup: a privacy relay, a disposable domain (C56's
 * pinned list, the domain or a parent), a free mailbox, or the organisation's own (`custom`); a
 * custom domain one edit from a major free-mail domain (the typo suggestion, H); and the MX
 * heuristic (H): a custom domain whose exchanges belong to a disposable service.
 *
 * In a sandbox environment the reserved names of C82.4 decide without any list:
 * `disposable.example` and `relay.example` (and their subdomains).
 */
import { matchDisposableDomain } from '../../contact/disposable-domains.js';
import type { EnvironmentKind } from '../../data/feature-table.js';
import {
  emailTypoReferences,
  freeMailProviderOf,
  mxProviderOf,
  relayProviderOf,
  type EmailTableProvider,
} from './tables.js';

/** The values of `email-domain-kind` (the contracts' enum). */
export const EMAIL_DOMAIN_KINDS = ['free_mail', 'relay', 'disposable', 'custom'] as const;
export type EmailDomainKind = (typeof EMAIL_DOMAIN_KINDS)[number];

/** What a domain is, and which provider says so. */
export interface EmailDomainClass {
  /** `null` when the disposable list is missing and no table names the domain. */
  readonly kind: EmailDomainKind | null;
  /** The free-mail or relay provider. */
  readonly provider: EmailTableProvider | null;
}

/** C82.4: the sandbox's reserved email domains (RFC 2606 names, never real). */
export const SANDBOX_EMAIL_DOMAINS = Object.freeze({
  disposable: 'disposable.example',
  relay: 'relay.example',
} as const);

/**
 * Classifies a lower-case ASCII domain: the sandbox names (sandbox only), then the disposable list
 * (`null` when the image has none), then the relay and free-mail tables; anything else is custom.
 */
export function classifyEmailDomain(
  domain: string,
  options: { disposable: ReadonlySet<string> | null; environment: EnvironmentKind },
): EmailDomainClass {
  if (options.environment === 'sandbox') {
    if (isOrUnder(domain, SANDBOX_EMAIL_DOMAINS.disposable)) {
      return { kind: 'disposable', provider: null };
    }
    if (isOrUnder(domain, SANDBOX_EMAIL_DOMAINS.relay)) {
      return { kind: 'relay', provider: null };
    }
  }
  if (options.disposable !== null && listed(domain, options.disposable)) {
    return { kind: 'disposable', provider: null };
  }
  const relay = relayProviderOf(domain);
  if (relay !== null) {
    return { kind: 'relay', provider: relay };
  }
  const freeMail = freeMailProviderOf(domain);
  if (freeMail !== null) {
    return { kind: 'free_mail', provider: freeMail };
  }
  return { kind: options.disposable === null ? null : 'custom', provider: null };
}

/** Whether the report asks RDAP for the domain's age (C85.3): custom domains, or unknown ones. */
export function shouldQueryEmailDomainAge(kind: EmailDomainKind | null): boolean {
  return kind === null || kind === 'custom';
}

/**
 * Whether two strings are at most one edit apart (optimal string alignment: an insertion, a
 * deletion, a substitution or a swap of neighbours), in one linear pass.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }
  let start = 0;
  while (start < a.length && start < b.length && a.charAt(start) === b.charAt(start)) {
    start += 1;
  }
  if (a.length !== b.length) {
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    return shorter.slice(start) === longer.slice(start + 1);
  }
  if (start === a.length || a.slice(start + 1) === b.slice(start + 1)) {
    return true;
  }
  return (
    a.charAt(start) === b.charAt(start + 1) &&
    a.charAt(start + 1) === b.charAt(start) &&
    a.slice(start + 2) === b.slice(start + 2)
  );
}

/**
 * The major free-mail domain a custom domain is one edit away from (`email-typo-references`, in
 * table order), or `null`. A free-mail domain is never a typo, even one edit from another
 * (`ymail.com` and `gmail.com`).
 */
export function emailTypoSuggestionOf(domain: string): string | null {
  if (freeMailProviderOf(domain) !== null) {
    return null;
  }
  return emailTypoReferences().find((reference) => withinOneEdit(domain, reference)) ?? null;
}

/**
 * C82.1's MX heuristic (H): some exchange's host, or a parent of it, is on the disposable list,
 * and it is not a known mailbox provider's.
 */
export function mxOfDisposableService(
  exchanges: readonly string[],
  disposable: ReadonlySet<string>,
): boolean {
  return exchanges.some((exchange) => {
    const host = exchange.toLowerCase().replace(/\.$/u, '');
    return host !== '' && mxProviderOf([host]) === null && listed(host, disposable);
  });
}

const isOrUnder = (domain: string, parent: string) =>
  domain === parent || domain.endsWith(`.${parent}`);

const listed = (domain: string, disposable: ReadonlySet<string>) =>
  matchDisposableDomain(domain, { listed: disposable, allow: [], deny: [] }) !== null;
