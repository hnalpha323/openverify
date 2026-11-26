/**
 * C207.2, C221.1 (Phase 10, Workflow 10C; `api-nfc`): the nfc client view's `prefillMrz` (the MRZ's
 * document number, birth date and expiry) never reaches a log line: pino replaces it wherever a
 * logged object carries it, in the API and in the workers.
 */
import { Writable } from 'node:stream';
import { NFC_PREFILL_MRZ_MEMBER } from '@openverify/contracts';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions, REDACT_PATHS, REDACTED } from './logger.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
      callback();
    },
  });
  const options = loggerOptions({ level: 'info' });
  if (options === false) {
    throw new Error('logging is on');
  }
  return { lines, logger: pino(options, stream) };
}

const PREFILL = { documentNumber: 'UT1234567', birthDate: '900412', expiryDate: '310411' };

describe('the API logger and prefillMrz (C221.1)', () => {
  it.each([0, 1, 2, 3])('redacts it %i objects deep', (depth) => {
    const { lines, logger } = capture();
    let logged: Record<string, unknown> = { [NFC_PREFILL_MRZ_MEMBER]: PREFILL, type: 'nfc' };
    for (let level = depth; level > 0; level -= 1) {
      logged = { [`level${String(level)}`]: logged };
    }

    logger.info(logged, 'line');

    const text = JSON.stringify(lines);
    expect(text).not.toContain('UT1234567');
    expect(text).not.toContain('900412');
    expect(text).toContain(REDACTED);
    expect(text).toContain('nfc');
  });

  it('names the member once per depth, by the contract’s name', () => {
    expect(REDACT_PATHS.filter((path) => path.endsWith(NFC_PREFILL_MRZ_MEMBER))).toEqual([
      'prefillMrz',
      '*.prefillMrz',
      '*.*.prefillMrz',
      '*.*.*.prefillMrz',
    ]);
  });
});
