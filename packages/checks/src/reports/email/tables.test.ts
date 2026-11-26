/**
 * C82.1: the authored email tables (free-mail, relay, role and MX-provider) and their build test:
 * no free-mail or relay domain is on the pinned disposable list, which the committed check record
 * proves for exactly these tables and exactly that list.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { riskConstant } from '../constants.js';
import { REPORT_DATA_DIRECTORY, readReportData } from '../data.js';
import {
  EMAIL_TABLE_FILES,
  emailTablesDigest,
  emailTypoReferences,
  findDisposableOverlaps,
  freeMailDomains,
  freeMailProviderOf,
  isRoleLocalPart,
  mxProviderOf,
  relayDomains,
  relayProviderOf,
} from './tables.js';

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const HOST = /^[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/u;

describe('freeMailProviderOf', () => {
  it.each([
    ['gmail.com', 'google'],
    ['googlemail.com', 'google'],
    ['outlook.com', 'microsoft'],
    ['hotmail.co.uk', 'microsoft'],
    ['live.com.au', 'microsoft'],
    ['yahoo.fr', 'yahoo'],
    ['ymail.com', 'yahoo'],
    ['aol.com', 'aol'],
    ['icloud.com', 'apple'],
    ['proton.me', 'proton'],
    ['gmx.de', 'gmx'],
    ['web.de', 'web-de'],
    ['mail.com', 'mail-com'],
    ['yandex.ru', 'yandex'],
    ['qq.com', 'tencent'],
    ['163.com', 'netease'],
    ['naver.com', 'naver'],
    ['seznam.cz', 'seznam'],
    ['wp.pl', 'wp'],
    ['libero.it', 'libero'],
  ])('reads %s as a free mailbox of %s', (domain, provider) => {
    expect(freeMailProviderOf(domain)?.id).toBe(provider);
  });

  it('names the provider and its own page', () => {
    expect(freeMailProviderOf('gmail.com')).toEqual({
      id: 'google',
      name: 'Gmail',
      source: 'https://mail.google.com/',
    });
  });

  it('answers for the domain itself only: a subdomain or a look-alike is not free mail', () => {
    expect(freeMailProviderOf('mail.gmail.com')).toBeNull();
    expect(freeMailProviderOf('gmail.co')).toBeNull();
    expect(freeMailProviderOf('example.com')).toBeNull();
    // Seen on 2026-10-27 with MX records of another company: not Microsoft's.
    expect(freeMailProviderOf('outlook.co.uk')).toBeNull();
  });
});

describe('relayProviderOf', () => {
  it.each([
    ['privaterelay.appleid.com', 'apple-private-relay'],
    ['mozmail.com', 'firefox-relay'],
    ['duck.com', 'duckduckgo'],
    ['simplelogin.com', 'simplelogin'],
    ['aleeas.com', 'simplelogin'],
    ['passmail.net', 'proton-pass'],
    ['anonaddy.me', 'addy'],
    ['addy.io', 'addy'],
  ])('reads %s as the relay of %s', (domain, provider) => {
    expect(relayProviderOf(domain)?.id).toBe(provider);
  });

  it('reads an alias subdomain by its parent', () => {
    expect(relayProviderOf('someone.33mail.com')?.id).toBe('33mail');
    expect(relayProviderOf('alias.anonaddy.com')?.id).toBe('addy');
  });

  it('never reads a parent of a relay, or a free mailbox, as a relay', () => {
    expect(relayProviderOf('appleid.com')).toBeNull();
    expect(relayProviderOf('gmail.com')).toBeNull();
    expect(relayProviderOf('icloud.com')).toBeNull();
  });
});

describe('isRoleLocalPart', () => {
  it.each([
    'info',
    'marketing',
    'sales',
    'support',
    'abuse',
    'noc',
    'security',
    'postmaster',
    'hostmaster',
    'usenet',
    'news',
    'webmaster',
    'www',
    'uucp',
    'ftp',
  ])('reads the RFC 2142 mailbox %s as a role', (name) => {
    expect(isRoleLocalPart(name)).toBe(true);
  });

  it.each(['admin', 'billing', 'contact', 'hello', 'help', 'hr', 'jobs', 'noreply', 'no-reply'])(
    'reads the authored role %s as a role',
    (name) => {
      expect(isRoleLocalPart(name)).toBe(true);
    },
  );

  it('compares lower-cased, after an RFC 5233 +tag', () => {
    expect(isRoleLocalPart('Info')).toBe(true);
    expect(isRoleLocalPart('postmaster+bounces')).toBe(true);
  });

  it('leaves a person’s mailbox alone', () => {
    expect(isRoleLocalPart('avery')).toBe(false);
    expect(isRoleLocalPart('info.avery')).toBe(false);
    expect(isRoleLocalPart('avery+info')).toBe(false);
    expect(isRoleLocalPart('')).toBe(false);
  });
});

describe('mxProviderOf', () => {
  it.each([
    [['gmail-smtp-in.l.google.com'], 'google'],
    [['aspmx.l.google.com', 'aspmx2.googlemail.com'], 'google'],
    [['eur.olc.protection.outlook.com'], 'microsoft'],
    [['contoso-com.mail.protection.outlook.com'], 'microsoft'],
    [['hotmail-nl.b-v1.mx.microsoft'], 'microsoft'],
    [['mta5.am0.yahoodns.net'], 'yahoo'],
    [['mx01.mail.icloud.com'], 'apple'],
    [['mail.protonmail.ch'], 'proton'],
    [['in1-smtp.messagingengine.com'], 'fastmail'],
    [['mx00.emig.gmx.net'], 'gmx'],
    [['mx.yandex.ru'], 'yandex'],
    [['mxs.mail.ru'], 'mail-ru'],
    [['mx1.qq.com'], 'tencent'],
    [['163mx01.mxmail.netease.com'], 'netease'],
  ] as const)('reads %j as %s', (exchanges, provider) => {
    expect(mxProviderOf(exchanges)?.id).toBe(provider);
  });

  it('skips null MX entries, ignores case and a trailing dot, and takes the first known', () => {
    expect(mxProviderOf(['', '.', 'MX01.MAIL.ICLOUD.COM.'])?.id).toBe('apple');
    expect(mxProviderOf(['mx.unknown.example', 'mx01.mail.icloud.com'])?.id).toBe('apple');
  });

  it('matches whole labels only, and knows nothing of other hosts', () => {
    expect(mxProviderOf(['notgoogle.com'])).toBeNull();
    expect(mxProviderOf(['google.com.evil.example'])).toBeNull();
    expect(mxProviderOf(['mx.unknown.example'])).toBeNull();
    expect(mxProviderOf([])).toBeNull();
  });

  it('gives kebab-case ids, as `email-mx-provider` takes them', () => {
    const table = readReportData('mx-providers.json') as {
      providers: { id: string; suffixes: string[]; source: string }[];
    };
    expect(table.providers.length).toBeGreaterThanOrEqual(15);
    for (const provider of table.providers) {
      expect(provider.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(provider.suffixes.length, provider.id).toBeGreaterThan(0);
      for (const suffix of provider.suffixes) {
        // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
        expect(suffix, provider.id).toMatch(/^[a-z\d-]+(?:\.[a-z\d-]+)+$/);
      }
    }
  });
});

describe('the authored tables (C82.1)', () => {
  it('are the four committed files, each with a description and a licence line', () => {
    for (const file of EMAIL_TABLE_FILES) {
      const table = readReportData(file) as { description: string; licence: string };
      expect(table.description, file).toMatch(/C82\.1/);
      expect(table.licence.length, file).toBeGreaterThan(10);
    }
  });

  it('hold about 200 free-mail domains, lower-case hosts, each under one provider', () => {
    const domains = freeMailDomains();
    expect(domains.length).toBeGreaterThanOrEqual(150);
    expect(domains.length).toBeLessThanOrEqual(300);
    expect(new Set(domains).size).toBe(domains.length);
    expect([...domains].sort()).toEqual(domains);
    for (const domain of domains) {
      expect(domain).toMatch(HOST);
      expect(freeMailProviderOf(domain)).not.toBeNull();
    }
  });

  it('cite an https page of each provider', () => {
    for (const file of ['free-mail-domains.json', 'relay-domains.json']) {
      const table = readReportData(file) as {
        providers: { id: string; name: string; source: string; domains: string[] }[];
      };
      for (const provider of table.providers) {
        expect(provider.source, provider.id).toMatch(/^https:\/\/[a-z0-9.-]+\//);
        expect(provider.name.length, provider.id).toBeGreaterThan(1);
        expect(provider.domains.length, provider.id).toBeGreaterThan(0);
      }
    }
  });

  it('keep relays and free mail apart', () => {
    const relays = relayDomains();
    expect(relays.length).toBeGreaterThanOrEqual(10);
    for (const relay of relays) {
      expect(relay).toMatch(HOST);
      expect(freeMailProviderOf(relay), relay).toBeNull();
    }
  });

  it('measure typos against at most 50 major domains with a first label of five letters or more', () => {
    const references = emailTypoReferences();
    expect(references.length).toBeGreaterThanOrEqual(10);
    expect(references.length).toBeLessThanOrEqual(50);
    expect(references).toEqual(expect.arrayContaining(['gmail.com', 'yahoo.com', 'hotmail.com']));
    for (const reference of references) {
      expect(freeMailProviderOf(reference), reference).not.toBeNull();
      expect((reference.split('.')[0] ?? '').length, reference).toBeGreaterThanOrEqual(
        riskConstant('email-typo-reference-min-label'),
      );
    }
  });

  it('hold the RFC 2142 names and about 80 role local parts, lower-case and unique', () => {
    const table = readReportData('role-local-parts.json') as {
      'rfc-2142': string[];
      authored: string[];
    };
    expect(table['rfc-2142']).toHaveLength(15);
    const all = [...table['rfc-2142'], ...table.authored];
    expect(all.length).toBeGreaterThanOrEqual(60);
    expect(new Set(all).size).toBe(all.length);
    for (const name of all) {
      expect(name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    }
  });
});

describe('emailTablesDigest', () => {
  it('is the SHA-256 of the sorted free-mail and relay domains, as canonical JSON', () => {
    const expected = createHash('sha256')
      .update(JSON.stringify([freeMailDomains(), relayDomains()]), 'utf8')
      .digest('hex');
    expect(emailTablesDigest()).toBe(expected);
  });
});

describe('findDisposableOverlaps', () => {
  it('finds a domain the list names, itself or by a parent, and nothing else', () => {
    expect(
      findDisposableOverlaps(
        ['b.example', 'a.example', 'sub.c.example', 'c.example.org'],
        new Set(['b.example', 'c.example']),
      ),
    ).toEqual(['b.example', 'sub.c.example']);
    expect(findDisposableOverlaps(['gmail.com'], new Set())).toEqual([]);
  });
});

interface ManifestEntry {
  name: string;
  sha256: string;
  license: string;
}

describe('the build test: no free-mail or relay domain is on the disposable list (C82.1)', () => {
  const check = readReportData('email-tables-check.json') as {
    'tables-sha256': string;
    disposable: ManifestEntry;
    overlaps: string[];
  };
  const manifest = JSON.parse(
    readFileSync(
      join(REPORT_DATA_DIRECTORY, '..', '..', '..', '..', 'data', 'manifest.json'),
      'utf8',
    ),
  ) as { data: ManifestEntry[] };
  const pinned = manifest.data.find((entry) => entry.name === 'disposable_email_domains');

  it('was run on exactly these tables', () => {
    expect(check['tables-sha256']).toBe(emailTablesDigest());
  });

  it('was run against the disposable list data/manifest.json pins today', () => {
    expect(pinned).toBeDefined();
    expect(check.disposable).toEqual({
      name: 'disposable_email_domains',
      sha256: pinned?.sha256,
      license: pinned?.license,
    });
  });

  it('found no overlap', () => {
    expect(check.overlaps).toEqual([]);
  });
});
