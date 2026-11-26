import { Writable } from 'node:stream';
import { REDACTED_PERSONAL_LOG_KEYS } from '@openverify/config/eslint-phase5';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions, PERSONAL_LOG_KEYS, REDACTED } from './logger.js';

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

/** `value` under `key`, nested `depth` objects deep (`{ a: { b: { key } } }` for depth 2). */
function nested(key: string, value: string, depth: number): Record<string, unknown> {
  let object: Record<string, unknown> = { [key]: value };
  for (let level = depth; level > 0; level -= 1) {
    object = { [`level${String(level)}`]: object };
  }
  return object;
}

describe('the API logger (C53.8)', () => {
  it('allows exactly the personal names the Phase 5 lint rule allows', () => {
    expect(PERSONAL_LOG_KEYS).toEqual(REDACTED_PERSONAL_LOG_KEYS);
  });

  it('redacts the Phase 6 names: the screened query, the matched and listed names, titles, the subject index', () => {
    expect(PERSONAL_LOG_KEYS).toEqual(
      expect.arrayContaining([
        'reportQuery',
        'matchedName',
        'listEntryName',
        'articleTitle',
        'subjectIndex',
      ]),
    );
  });

  it.each(PERSONAL_LOG_KEYS.flatMap((key) => [0, 1, 2].map((depth) => [key, depth] as const)))(
    'redacts %s at depth %i',
    (key, depth) => {
      const { lines, logger } = capture();
      const secret = `synthetic-${key}-${String(depth)}`;

      logger.info(nested(key, secret, depth), 'line');

      expect(JSON.stringify(lines)).not.toContain(secret);
      expect(JSON.stringify(lines)).toContain(REDACTED);
    },
  );

  it('keeps a logged error message and code: no generic key is redacted', () => {
    const { lines, logger } = capture();
    const error = Object.assign(new Error('Synthetic provider failure'), { code: 'upstream_down' });

    logger.error({ err: error, code: 'outer_code', message: 'kept' }, 'failed');

    expect(lines[0]).toMatchObject({
      err: { message: 'Synthetic provider failure', code: 'upstream_down' },
      code: 'outer_code',
      message: 'kept',
    });
  });
});
