/**
 * C82.1: the authored email tables (`packages/checks/data/reports/`), committed and reviewed:
 * - `free-mail-domains.json`: consumer mailbox domains anyone can sign up for free, by provider,
 *   each provider citing its own page; the ones typos are measured against are marked;
 * - `relay-domains.json`: privacy relays (an address that forwards to a hidden mailbox);
 * - `role-local-parts.json`: RFC 2142 mailbox names plus authored ones;
 * - `mx-providers.json`: mail providers by the host-name suffix of their MX exchanges.
 *
 * Every domain of the first two was seen with MX records pointing at its provider when authored;
 * none is on the pinned disposable list (`email-tables-check.json`, written by the builder).
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { matchDisposableDomain } from '../../contact/disposable-domains.js';
import { readReportData } from '../data.js';

/** A provider of one of the tables: its id (kebab-case), its name and its own page. */
export interface EmailTableProvider {
  readonly id: string;
  readonly name: string;
  readonly source: string;
}

/** The authored tables' files. */
export const EMAIL_TABLE_FILES = Object.freeze([
  'free-mail-domains.json',
  'relay-domains.json',
  'role-local-parts.json',
  'mx-providers.json',
] as const);

const providerSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  source: z.string().min(1),
});
const domainProviderSchema = providerSchema.extend({
  domains: z.array(z.string().min(3)).min(1),
  'typo-references': z.array(z.string()).optional(),
});
const domainTableSchema = z.object({ providers: z.array(domainProviderSchema) });
const roleTableSchema = z.object({
  'rfc-2142': z.array(z.string().min(1)),
  authored: z.array(z.string().min(1)),
});
const mxTableSchema = z.object({
  providers: z.array(providerSchema.extend({ suffixes: z.array(z.string().min(3)).min(1) })),
});

interface EmailTables {
  readonly freeMail: ReadonlyMap<string, EmailTableProvider>;
  readonly relays: ReadonlyMap<string, EmailTableProvider>;
  readonly typoReferences: readonly string[];
  readonly roles: ReadonlySet<string>;
  readonly mx: readonly (readonly [suffix: string, provider: EmailTableProvider])[];
}

let loaded: EmailTables | undefined;

const providerOf = ({ id, name, source }: EmailTableProvider): EmailTableProvider =>
  Object.freeze({ id, name, source });

function domainsByProvider(file: string): {
  domains: Map<string, EmailTableProvider>;
  references: string[];
} {
  const domains = new Map<string, EmailTableProvider>();
  const references: string[] = [];
  for (const entry of domainTableSchema.parse(readReportData(file)).providers) {
    const provider = providerOf(entry);
    for (const domain of entry.domains) {
      domains.set(domain, provider);
    }
    references.push(...(entry['typo-references'] ?? []));
  }
  return { domains, references };
}

function tables(): EmailTables {
  if (loaded === undefined) {
    const freeMail = domainsByProvider('free-mail-domains.json');
    const roles = roleTableSchema.parse(readReportData('role-local-parts.json'));
    const mx = mxTableSchema.parse(readReportData('mx-providers.json'));
    loaded = {
      freeMail: freeMail.domains,
      relays: domainsByProvider('relay-domains.json').domains,
      typoReferences: Object.freeze(freeMail.references),
      roles: new Set([...roles['rfc-2142'], ...roles.authored]),
      mx: mx.providers.flatMap((entry) => {
        const provider = providerOf(entry);
        return entry.suffixes.map((suffix) => [suffix, provider] as const);
      }),
    };
  }
  return loaded;
}

/** The free-mail provider of a lower-case ASCII domain (the domain itself, never a parent). */
export function freeMailProviderOf(domain: string): EmailTableProvider | null {
  return tables().freeMail.get(domain) ?? null;
}

/** The relay provider of a lower-case ASCII domain or of one of its parents. */
export function relayProviderOf(domain: string): EmailTableProvider | null {
  const labels = domain.split('.');
  const { relays } = tables();
  for (let depth = 0; labels.length - depth >= 2; depth += 1) {
    const found = relays.get(labels.slice(depth).join('.'));
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}

/**
 * Whether a local part names a role mailbox: compared lower-cased, after cutting an RFC 5233
 * `+tag`.
 */
export function isRoleLocalPart(localPart: string): boolean {
  const name = localPart.toLowerCase().split('+', 1)[0] ?? '';
  return name !== '' && tables().roles.has(name);
}

/**
 * The mail provider of the first exchange (in the order given, most preferred first) whose host
 * name ends with a known suffix; null MX entries (`''`, `.`) are skipped.
 */
export function mxProviderOf(exchanges: readonly string[]): EmailTableProvider | null {
  const { mx } = tables();
  for (const exchange of exchanges) {
    const host = exchange.toLowerCase().replace(/\.$/u, '');
    if (host === '') {
      continue;
    }
    const found = mx.find(([suffix]) => host === suffix || host.endsWith(`.${suffix}`));
    if (found !== undefined) {
      return found[1];
    }
  }
  return null;
}

/** Every free-mail domain, sorted. */
export function freeMailDomains(): readonly string[] {
  return [...tables().freeMail.keys()].sort();
}

/** Every relay domain, sorted. */
export function relayDomains(): readonly string[] {
  return [...tables().relays.keys()].sort();
}

/** The free-mail domains a custom domain one edit away from is read as a typo of. */
export function emailTypoReferences(): readonly string[] {
  return tables().typoReferences;
}

/**
 * The SHA-256 (lower-case hex) of the free-mail and relay domains as the disposable check reads
 * them: the canonical JSON of `[free-mail domains, relay domains]`, each sorted.
 */
export function emailTablesDigest(): string {
  return createHash('sha256')
    .update(JSON.stringify([freeMailDomains(), relayDomains()]), 'utf8')
    .digest('hex');
}

/**
 * The domains of `domains` that a disposable list names, themselves or by a parent (C56's
 * `matchDisposableDomain`), sorted.
 */
export function findDisposableOverlaps(
  domains: readonly string[],
  disposable: ReadonlySet<string>,
): string[] {
  return domains
    .filter(
      (domain) =>
        matchDisposableDomain(domain, { listed: disposable, allow: [], deny: [] }) !== null,
    )
    .sort();
}
