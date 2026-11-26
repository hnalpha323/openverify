// @vitest-environment node
/**
 * C161.8, C162.9 (verification round V01): `apps/flow/scripts/export-flow-locales.ts` writes one
 * JSON per built-in locale to `contracts/fixtures/i18n/<locale>.json`, the source of Phase 10's
 * Android catalogs, and appends the consent texts as written (placeholders unfilled) to the
 * append-only `contracts/fixtures/i18n/consent-texts.json`, one entry per catalog version, client,
 * key and locale, from which the server computes the digest of the words a person was shown. The
 * committed files must match the catalogs, and no entry may ever leave the table.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCALE_REVIEW_STATUS, catalogSha256, localeKeyDigests } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { FLOW_CATALOG_VERSION } from './catalog-version';
import { CATALOGS } from './catalogs';
import { SUPPORTED_LANGUAGES } from './languages';
import {
  CATALOG_VERSION_MODULE,
  appendConsentTexts,
  catalogVersionModule,
  catalogVersionOf,
  consentTextsOf,
  exportFiles,
  localeExportOf,
  removedConsentTexts,
  type ConsentTextsTable,
} from './locale-export';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const I18N_FIXTURES = 'contracts/fixtures/i18n/';
const CONSENT_TEXTS = `${I18N_FIXTURES}consent-texts.json`;

function committed(path: string): unknown {
  return JSON.parse(readFileSync(`${REPO_ROOT}${path}`, 'utf8'));
}

function withConsentText(key: 'biometric' | 'title', text: string) {
  return { ...CATALOGS, en: { ...CATALOGS.en, consent: { ...CATALOGS.en.consent, [key]: text } } };
}

describe('the consent texts (C162.9)', () => {
  it('are every consent and notice message, in every locale, placeholders unfilled', () => {
    const texts = consentTextsOf(CATALOGS);
    const keys = [...new Set(texts.map(({ key }) => key))];

    expect(keys).toContain('consent.biometric');
    expect(keys).toContain('consent.biometric-matching');
    expect(keys).toContain('notice.session-integrity');
    // C238.3 (Workflow 11A): the built-in share-consent texts are consent texts too.
    expect(
      keys.every((key) =>
        ['consent.', 'notice.', 'share.consent.'].some((group) => key.startsWith(group)),
      ),
    ).toBe(true);
    expect(texts).toHaveLength(keys.length * SUPPORTED_LANGUAGES.length);
    expect(texts).toContainEqual({
      key: 'consent.biometric-matching',
      locale: 'fr',
      text: CATALOGS.fr.consent['biometric-matching'],
    });
    expect(CATALOGS.fr.consent['biometric-matching']).toContain('{{days}}');
  });
});

describe('the catalog version', () => {
  it('names the consent texts it was built from', () => {
    const version = catalogVersionOf(CATALOGS, sha256);

    expect(version).toMatch(/^web-[0-9a-f]{16}$/);
    expect(catalogVersionOf(CATALOGS, sha256)).toBe(version);
    expect(catalogVersionOf(withConsentText('biometric', 'Changed.'), sha256)).not.toBe(version);
  });

  it('is the one the flow sends with every consent', () => {
    expect(FLOW_CATALOG_VERSION).toBe(catalogVersionOf(CATALOGS, sha256));
  });
});

describe('the locale exports (C161.8)', () => {
  it.each(SUPPORTED_LANGUAGES)(
    '%s carries its messages, version, digest and review status',
    (locale) => {
      const exported = localeExportOf(locale, CATALOGS, sha256);

      expect(exported).toEqual({
        locale,
        'catalog-version': catalogVersionOf(CATALOGS, sha256),
        'catalog-sha256': catalogSha256(localeKeyDigests(CATALOGS[locale], sha256), sha256),
        'review-status': LOCALE_REVIEW_STATUS[locale],
        messages: CATALOGS[locale],
      });
    },
  );

  it.each(SUPPORTED_LANGUAGES)('%s is committed as the catalog is', (locale) => {
    expect(committed(`${I18N_FIXTURES}${locale}.json`)).toEqual(
      JSON.parse(JSON.stringify(localeExportOf(locale, CATALOGS, sha256))),
    );
  });
});

describe('the append-only consent-texts table (C162.9, V01)', () => {
  it('appends each consent text once per catalog version, client, key and locale', () => {
    const table = appendConsentTexts(null, CATALOGS, sha256);
    const version = catalogVersionOf(CATALOGS, sha256);

    expect(table.format).toBe(1);
    expect(table.entries).toHaveLength(consentTextsOf(CATALOGS).length);
    const [first] = table.entries;
    expect(first?.['catalog-version']).toBe(version);
    expect(first?.client).toBe('web');
    expect(first?.key).toMatch(/^(consent|notice)\./);
    expect(first?.locale).toBe('en');
    expect(Object.keys(first ?? {})).toEqual([
      'catalog-version',
      'client',
      'key',
      'locale',
      'text',
    ]);
    expect(appendConsentTexts(table, CATALOGS, sha256)).toEqual(table);
  });

  it('keeps every earlier entry when a consent text changes, and adds the new version’s', () => {
    const before = appendConsentTexts(null, CATALOGS, sha256);
    const changed = withConsentText('biometric', 'A changed consent text.');
    const after = appendConsentTexts(before, changed, sha256);

    expect(after.entries.slice(0, before.entries.length)).toEqual(before.entries);
    expect(after.entries.length).toBe(before.entries.length * 2);
    expect(removedConsentTexts(before, after)).toEqual([]);
  });

  it('refuses removing an entry', () => {
    const table = appendConsentTexts(null, CATALOGS, sha256);
    const [first, ...rest] = table.entries;
    const shortened: ConsentTextsTable = { ...table, entries: rest };

    expect(removedConsentTexts(table, shortened)).toEqual([first]);
    expect(
      removedConsentTexts(table, {
        ...table,
        entries: table.entries.map((entry, index) =>
          index === 0 ? { ...entry, text: `${entry.text} (edited)` } : entry,
        ),
      }),
    ).toEqual([first]);
  });

  it('keeps every row of another client in place, and names who writes them (C200.3, F07)', () => {
    const android = {
      'catalog-version': 'android-0.1.0-0123456789abcdef',
      client: 'android',
      key: 'consent.processing',
      locale: 'en',
      text: 'A synthetic Android consent text.',
    };
    const web = appendConsentTexts(null, CATALOGS, sha256);
    const table: ConsentTextsTable = {
      ...web,
      entries: [web.entries[0], android, ...web.entries.slice(1)].filter(
        (entry) => entry !== undefined,
      ),
    };
    const after = appendConsentTexts(
      table,
      withConsentText('biometric', 'A changed consent text.'),
      sha256,
    );

    expect(after.entries.slice(0, table.entries.length)).toEqual(table.entries);
    expect(after.entries.filter(({ client }) => client === 'android')).toEqual([android]);
    expect(removedConsentTexts(table, after)).toEqual([]);
    expect(after.description).toContain(':openverify-sdk:exportConsentTexts');
    expect(after.description).toContain('client android');
  });

  it('is committed with every consent text of the catalogs as they are', () => {
    const table = committed(CONSENT_TEXTS) as ConsentTextsTable;

    expect(appendConsentTexts(table, CATALOGS, sha256)).toEqual(table);
  });

  it('has lost no entry of any committed version of itself', () => {
    const revisions = execFileSync('git', ['log', '--format=%H', '--', CONSENT_TEXTS], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line !== '');
    const now = committed(CONSENT_TEXTS) as ConsentTextsTable;

    for (const revision of revisions) {
      const then = JSON.parse(
        execFileSync('git', ['show', `${revision}:${CONSENT_TEXTS}`], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      ) as ConsentTextsTable;
      expect(removedConsentTexts(then, now), revision).toEqual([]);
    }
  });
});

describe('exportFiles: everything the script writes', () => {
  it('names the five locale exports, the table and the catalog version module', () => {
    const table = committed(CONSENT_TEXTS) as ConsentTextsTable;
    const files = exportFiles(table, sha256);

    expect(Object.keys(files)).toEqual([
      ...SUPPORTED_LANGUAGES.map((locale) => `${I18N_FIXTURES}${locale}.json`),
      CONSENT_TEXTS,
      CATALOG_VERSION_MODULE,
    ]);
    expect(files[CONSENT_TEXTS]).toEqual(table);
    expect(files[CATALOG_VERSION_MODULE]).toBe(
      readFileSync(`${REPO_ROOT}${CATALOG_VERSION_MODULE}`, 'utf8'),
    );
    expect(catalogVersionModule('web-0123456789abcdef')).toContain(
      "export const FLOW_CATALOG_VERSION = 'web-0123456789abcdef';",
    );
  });
});

describe('apps/flow/scripts/export-flow-locales.ts', () => {
  it('finds the committed files up to date (--check)', () => {
    const output = execFileSync(
      process.execPath,
      ['apps/flow/scripts/export-flow-locales.ts', '--check'],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    expect(output).toContain('up to date');
  }, 30_000);
});
