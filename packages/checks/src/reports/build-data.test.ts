/**
 * The dev-only builder of the generated report tables, on synthetic pinned files: it reads only
 * files whose SHA-256 the manifest pins, and refuses to record a disposable check that failed.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMAIL_TABLES_CHECK_FILE,
  buildReportData,
  emailTablesCheck,
  serializeReportTable,
  type ManifestEntry,
} from './build-data.js';
import { US_ZIP_PREFIXES_FILE } from './address/us-zip.js';
import { emailTablesDigest } from './email/tables.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const LIST = '# synthetic\ntrash.example\nthrowaway.example\n';
const entryOf = (text: string): ManifestEntry => ({
  name: 'disposable_email_domains',
  filename: 'disposable_email_blocklist.conf',
  sha256: sha256(text),
  license: 'CC0-1.0',
});
const COUNTRY_INFO = `data/US=${JSON.stringify({
  id: 'data/US',
  key: 'US',
  sub_keys: 'AL~CA',
  sub_zips: '3[56]~9[0-5]|96[01]',
  sub_zipexs: '35000,36999~90000,96199',
})}\n`;
const countryInfoEntry: ManifestEntry = {
  name: 'libaddressinput_countryinfo',
  filename: 'libaddressinput-countryinfo.txt',
  sha256: sha256(COUNTRY_INFO),
  license: 'CC-BY-4.0',
};
const PINNED = [entryOf(LIST), countryInfoEntry];
const FILES = {
  'disposable_email_blocklist.conf': LIST,
  'libaddressinput-countryinfo.txt': COUNTRY_INFO,
};

describe('emailTablesCheck', () => {
  it('records the tables’ digest and the list it was checked against, with no overlap', () => {
    expect(emailTablesCheck(LIST, entryOf(LIST))).toEqual({
      description: expect.stringMatching(/C82\.1/) as unknown,
      'tables-sha256': emailTablesDigest(),
      disposable: { name: 'disposable_email_domains', sha256: sha256(LIST), license: 'CC0-1.0' },
      overlaps: [],
    });
  });

  it('refuses a list that names a free-mail domain, naming it', () => {
    const list = `${LIST}gmail.com\n`;
    expect(() => emailTablesCheck(list, entryOf(list))).toThrow(/gmail\.com/);
  });

  it('refuses a list that names a relay domain, or its parent', () => {
    const list = `${LIST}33mail.com\n`;
    expect(() => emailTablesCheck(list, entryOf(list))).toThrow(/33mail\.com/);
  });
});

describe('serializeReportTable', () => {
  it('writes two-space JSON with a final newline', () => {
    const text = serializeReportTable({ a: 1, b: ['x'] });
    expect(JSON.parse(text)).toEqual({ a: 1, b: ['x'] });
    expect(text).toBe('{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}\n');
  });
});

describe('buildReportData', () => {
  let root: string;

  const writeData = (manifest: readonly ManifestEntry[], files: Record<string, string>) => {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'manifest.json'), JSON.stringify({ data: manifest }));
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(root, 'data', name), text);
    }
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openverify-report-data-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('builds the disposable check from the pinned list', () => {
    writeData(PINNED, FILES);

    const tables = buildReportData(root);

    const check = JSON.parse(tables[EMAIL_TABLES_CHECK_FILE] ?? '') as { overlaps: string[] };
    expect(check.overlaps).toEqual([]);
  });

  it('builds the US ZIP prefixes from the pinned libaddressinput file, citing it (CC BY 4.0)', () => {
    writeData(PINNED, FILES);

    const table = JSON.parse(buildReportData(root)[US_ZIP_PREFIXES_FILE] ?? '') as {
      licence: string;
      sources: unknown[];
      states: Record<string, string>;
    };

    expect(table.states).toEqual({ AL: '3[56]', CA: '9[0-5]|96[01]' });
    expect(table.sources).toEqual([
      { name: 'libaddressinput_countryinfo', sha256: sha256(COUNTRY_INFO), license: 'CC-BY-4.0' },
    ]);
    expect(table.licence).toMatch(/CC BY 4\.0/);
  });

  it('refuses a file that is not the pinned one', () => {
    writeData(PINNED, { ...FILES, 'disposable_email_blocklist.conf': `${LIST}added.example\n` });

    expect(() => buildReportData(root)).toThrow(/not the pinned file/);
  });

  it('refuses a source the manifest does not list', () => {
    writeData([], {});

    expect(() => buildReportData(root)).toThrow(/disposable_email_domains is not in/);
  });
});
