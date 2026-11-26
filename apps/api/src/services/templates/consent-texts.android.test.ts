/**
 * C200.4 (Workflow 10A, api-android-10a; reviews H07, F06, V13): the Android consent digest vectors,
 * `contracts/fixtures/i18n/android-consent-digests.json`. For each Android row of the append-only
 * table `consent-texts.json` (client `android`, written by `:openverify-sdk:exportConsentTexts`) at
 * two retention values, the `text-sha256` the server's own fill and hash expect
 * (`consentTextDigest`, the function `checkConsentTextsInTx` runs), so the SDK's host test, which
 * renders each text through its real consent screen, takes the same digest. Three cases add an
 * organisation name as the session serves it (NFC): a Latin name beside an Arabic text, a name
 * stored decomposed, and a Korean name of precomposed syllables. No built-in text holds
 * `{{organization}}` (10A decision 6), so today those three digests equal their row's; they hold the
 * device to the server's fill if one ever does.
 *
 * Assert-only (C221.8): the test fails when the committed file differs from what the server's fill
 * and hash give, and writes it only under `UPDATE_CONTRACT_FIXTURES=1`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FACE_TEMPLATE_RETENTION_DAYS } from '@openverify/contracts';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { consentTextDigest } from './consent-texts.js';

const I18N = fileURLToPath(new URL('../../../../../contracts/fixtures/i18n/', import.meta.url));
const TABLE = `${I18N}consent-texts.json`;
const FILE = `${I18N}android-consent-digests.json`;
const SCHEMA = `${I18N}android-consent-digests.schema.json`;

interface Row {
  readonly 'catalog-version': string;
  readonly client: string;
  readonly key: string;
  readonly locale: string;
  readonly text: string;
}

interface DigestCase {
  readonly name?: string;
  readonly 'catalog-version': string;
  readonly key: string;
  readonly locale: string;
  readonly values: { readonly days: string; readonly organization?: string };
  readonly 'text-sha256': string;
}

/** KP10-9: an operator's consent text, as the session's copy serves it, and the digest the server expects of it. */
interface CustomCase {
  readonly name: string;
  readonly 'copy-source': 'custom';
  readonly key: string;
  readonly locale: string;
  readonly text: string;
  readonly values: { readonly days: string; readonly organization?: string };
  readonly 'text-sha256': string;
}

const cp = (...codes: readonly number[]): string => String.fromCodePoint(...codes);

/** The two retention values: the default and a short window (C42.6), as the server writes them. */
const RETENTION_DAYS = [FACE_TEMPLATE_RETENTION_DAYS.default, 30].map(String);

/** The organisation names: as stored, and as the session serves them (NFC, C221.12). */
const ORGANIZATIONS = [
  {
    name: 'a Latin organisation name beside an Arabic text',
    locale: 'ar',
    stored: 'Example Verification Ltd',
  },
  {
    name: 'an organisation name stored decomposed',
    locale: 'en',
    stored: `Cafe${cp(0x0301)} Exemple`,
  },
  {
    name: 'a Korean organisation name of precomposed syllables',
    locale: 'en',
    stored: cp(0xd55c, 0xad6d, 0x0020, 0xc778, 0xc99d),
  },
] as const;

/**
 * KP10-9: synthetic operator texts (`{name}` placeholders, C162.3), written for these vectors, with
 * the organisation's name in the three forms above and one retention text.
 */
const CUSTOM_TEXTS = [
  {
    name: 'an operator text in Arabic with a Latin organisation name',
    key: 'consent.biometric',
    locale: 'ar',
    text: '{organization} تقارن صورتك الذاتية بصورة وثيقة هويتك.',
    stored: 'Example Verification Ltd',
  },
  {
    name: 'an operator text with an organisation name stored decomposed',
    key: 'consent.processing',
    locale: 'en',
    text: '{organization} processes your photos for this verification.',
    stored: `Cafe${cp(0x0301)} Exemple`,
  },
  {
    name: 'an operator text with a Korean organisation name of precomposed syllables',
    key: 'notice.session-integrity',
    locale: 'en',
    text: '{organization} checks this session for signs of automation.',
    stored: cp(0xd55c, 0xad6d, 0x0020, 0xc778, 0xc99d),
  },
  {
    name: 'an operator text naming the retention in days',
    key: 'consent.biometric-matching',
    locale: 'es',
    text: '{organization} guarda la plantilla de tu rostro durante {days} días.',
    stored: 'Example Verification Ltd',
  },
] as const;

function customCases(): CustomCase[] {
  const days = RETENTION_DAYS[0] ?? '365';
  return CUSTOM_TEXTS.map(({ name, key, locale, text, stored }) => {
    const values = { days, organization: stored.normalize('NFC') };
    const digest = consentTextDigest(text, values, false);
    // The server fills its stored name and normalises the whole text; the device fills the served (NFC) name.
    expect(digest).toBe(consentTextDigest(text, { days, organization: stored }, false));
    return { name, 'copy-source': 'custom', key, locale, text, values, 'text-sha256': digest };
  });
}

/** The placeholders the server fills in a built-in text (C162.9). */
const FILLED = new Set(['days', 'organization']);

/**
 * The Android rows of the latest catalog version, the last the append-only table holds (Workflow 10B
 * integration-10b, decision 66): the current SDK shows those texts only. An earlier version's rows stay
 * in the table, and the server still accepts their digests from an SDK that shipped them.
 */
const androidRows = (): Row[] => {
  const android = (JSON.parse(readFileSync(TABLE, 'utf8')) as { entries: Row[] }).entries.filter(
    ({ client }) => client === 'android',
  );
  const latest = android.at(-1)?.['catalog-version'];
  return android.filter((row) => row['catalog-version'] === latest);
};

function digestCases(rows: readonly Row[]): DigestCase[] {
  const of = (row: Row, values: DigestCase['values'], name?: string): DigestCase => ({
    ...(name === undefined ? {} : { name }),
    'catalog-version': row['catalog-version'],
    key: row.key,
    locale: row.locale,
    values,
    'text-sha256': consentTextDigest(row.text, values, true),
  });
  const plain = rows.flatMap((row) => RETENTION_DAYS.map((days) => of(row, { days })));
  const withNames = ORGANIZATIONS.map(({ name, locale, stored }) => {
    const row = rows.find((candidate) => candidate.locale === locale);
    if (row === undefined) {
      throw new Error(`no Android row in ${locale}`);
    }
    const days = RETENTION_DAYS[0] ?? '365';
    const served = of(row, { days, organization: stored.normalize('NFC') }, name);
    // The server fills what it stores and normalises the whole text; the device fills what is served.
    expect(served['text-sha256']).toBe(
      consentTextDigest(row.text, { days, organization: stored }, true),
    );
    return served;
  });
  return [...plain, ...withNames];
}

function exportOf(rows: readonly Row[]): Record<string, unknown> {
  return {
    format: 1,
    description:
      "C200.4: for each Android row of consent-texts.json (client android) of its latest catalog version at two retention values, the text-sha256 the server's own fill and hash expect (consentTextDigest, apps/api/src/services/templates/consent-texts.ts): {{days}} and {{organization}} filled, NFC, UTF-8, SHA-256. organization is the name as the session serves it (NFC); its three cases add a Latin name beside an Arabic text, a name stored decomposed and a Korean name, and no built-in text holds {{organization}} today. Custom-copy cases (copy-source custom, KP10-9) hold an operator's text with its {name} placeholders as the session's copy serves it, and the digest the server takes of it filled. Written by apps/api/src/services/templates/consent-texts.android.test.ts with UPDATE_CONTRACT_FIXTURES=1; never edited by hand.",
    cases: [...digestCases(rows), ...customCases()],
  };
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('contracts/fixtures/i18n/android-consent-digests.json (C200.4)', () => {
  const rows = androidRows();

  it('has Android rows to take digests of, each NFC and holding only the placeholders the server fills', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.text.normalize('NFC'), `${row.locale} ${row.key}`).toBe(row.text);
      const placeholders = [...row.text.matchAll(/\{\{([a-z_]+)\}\}/g)].map((match) => match[1]);
      expect(
        placeholders.filter((name) => !FILLED.has(name ?? '')),
        row.key,
      ).toEqual([]);
      expect(row.text, row.key).not.toMatch(/%[0-9]+\$[a-z]/);
    }
  });

  it('is the digest of the text a device fills without normalising, with ASCII digits', () => {
    for (const entry of digestCases(rows)) {
      const row = rows.find(
        (candidate) =>
          candidate['catalog-version'] === entry['catalog-version'] &&
          candidate.key === entry.key &&
          candidate.locale === entry.locale,
      );
      expect(row).toBeDefined();
      const filled = Object.entries(entry.values).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
        row?.text ?? '',
      );
      expect(/^[0-9]+$/.test(entry.values.days)).toBe(true);
      expect(sha256(filled), `${entry.locale} ${entry.key}`).toBe(entry['text-sha256']);
    }
  });

  it('holds custom-copy cases whose digest is the device fill of the operator text, with no placeholder left (KP10-9)', () => {
    const custom = customCases();
    expect(custom.length).toBeGreaterThanOrEqual(3);
    for (const entry of custom) {
      const filled = Object.entries(entry.values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, value),
        entry.text,
      );
      expect(filled, entry.name).not.toMatch(/\{[a-z_]+\}/);
      expect(sha256(filled), entry.name).toBe(entry['text-sha256']);
    }
  });

  it('meets its JSON Schema', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      JSON.parse(readFileSync(SCHEMA, 'utf8')) as object,
    );
    expect(validate(exportOf(rows)), JSON.stringify(validate.errors)).toBe(true);
  });

  it('is the committed file', async () => {
    const expected = await format(JSON.stringify(exportOf(rows), null, 2), {
      ...(await resolveConfig(FILE)),
      filepath: FILE,
    });
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      writeFileSync(FILE, expected);
    }
    expect(existsSync(FILE) ? readFileSync(FILE, 'utf8') : null).toBe(expected);
  });
});
