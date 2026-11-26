/**
 * The package surface Workflow 5B Stage 1 fixed, and the end of its stubs: every verifier and
 * builder is built, so no source file still answers `EmrtdNotImplementedError` (a stub never
 * returned a report, so nothing could read one as a verified chip, ADR 0002 §3a).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMRTD_ERROR_CODES,
  EmrtdError,
  EmrtdNotImplementedError,
  ICAO_OIDS,
  PACKAGE_NAME,
} from './index.js';
import { TESTING_ENTRY, UTOPIA } from './testing/index.js';

describe('the Stage 2 functions are built', () => {
  it('leaves no stub in any source file', () => {
    const root = path.resolve(import.meta.dirname);
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'errors.ts',
    );
    const stubbed = sources.filter((file) =>
      readFileSync(path.join(root, file), 'utf8').includes('notImplemented('),
    );
    expect(stubbed).toEqual([]);
  });

  it('keeps the not-implemented error for a stub a later stage adds', () => {
    const error = new EmrtdNotImplementedError('feature', 2);
    expect(error.feature).toBe('feature');
    expect(error.message).toContain('owner: emrtd');
  });
});

describe('the package surface', () => {
  it('names itself and its testing entry', () => {
    expect(PACKAGE_NAME).toBe('@openverify/emrtd');
    expect(TESTING_ENTRY).toBe('@openverify/emrtd/testing');
  });

  it('names the specimen state Utopia (UTO, UT)', () => {
    expect(UTOPIA).toEqual({ alpha3: 'UTO', alpha2: 'UT' });
  });

  it('holds the ICAO object identifiers the verifier and the sync read', () => {
    expect(ICAO_OIDS).toEqual({
      ldsSecurityObject: '2.23.136.1.1.1',
      cscaMasterList: '2.23.136.1.1.2',
      cscaMasterListSigningKey: '2.23.136.1.1.3',
      documentTypeList: '2.23.136.1.1.6.2',
    });
  });

  it('gives an EmrtdError a code and a message that names only the step', () => {
    const error = new EmrtdError('limit_exceeded', 'prescanTlv');
    expect(error.code).toBe('limit_exceeded');
    expect(error.message).toBe('prescanTlv: limit_exceeded');
    expect(EMRTD_ERROR_CODES).toContain(error.code);
  });
});
