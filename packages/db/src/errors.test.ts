import { describe, expect, it } from 'vitest';
import {
  InvalidCursorError,
  SensitiveQueryError,
  pgErrorCode,
  withSensitiveParameters,
} from './errors.js';

/** The shape node-postgres and PGlite give a server error (`DatabaseError`). */
const databaseError = (code: string) =>
  Object.assign(new Error('server error'), { code, severity: 'ERROR' });

describe('pgErrorCode', () => {
  it('reads the SQLSTATE of a driver error', () => {
    expect(pgErrorCode(databaseError('23505'))).toBe('23505');
  });

  it('reads the SQLSTATE through the causes Drizzle wraps around driver errors', () => {
    const wrapped = new Error('Failed query', {
      cause: new Error('outer', { cause: databaseError('23503') }),
    });

    expect(pgErrorCode(wrapped)).toBe('23503');
  });

  it.each([
    ['a plain error', new Error('nope')],
    ['a non-SQLSTATE code', Object.assign(new Error('fs'), { code: 'ENOENT' })],
    ['a five-letter Node system code', Object.assign(new Error('pipe'), { code: 'EPIPE' })],
    ['a string', 'boom'],
    ['null', null],
  ])('returns undefined for %s', (_label, error) => {
    expect(pgErrorCode(error)).toBeUndefined();
  });

  it('stops on cyclic causes', () => {
    const error = new Error('loop') as Error & { cause?: unknown };
    error.cause = error;

    expect(pgErrorCode(error)).toBeUndefined();
  });
});

describe('InvalidCursorError', () => {
  it('carries a stable code and never echoes the cursor', () => {
    const error = new InvalidCursorError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidCursorError');
    expect(error.code).toBe('invalid_cursor');
    expect(error.message).toBe('page[after] does not name a record in this list');
  });
});

describe('withSensitiveParameters (Workflow 4B review H001)', () => {
  it('answers what the query answers', async () => {
    expect(await withSensitiveParameters('op', () => Promise.resolve(7))).toBe(7);
  });

  it('rethrows a server error with the operation and SQLSTATE only, and no cause', async () => {
    const failure = Object.assign(new Error('Failed query: params: 37.123'), {
      cause: databaseError('57014'),
    });
    const error: unknown = await withSensitiveParameters('op', () => Promise.reject(failure)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(SensitiveQueryError);
    expect(error).toMatchObject({ message: 'op failed (SQLSTATE 57014)', code: '57014' });
    expect((error as Error).cause).toBeUndefined();
    expect(pgErrorCode(error)).toBe('57014');
  });

  it('names no SQLSTATE when the server did not answer', async () => {
    const error: unknown = await withSensitiveParameters('op', () =>
      Promise.reject(new Error('connection reset 37.123')),
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'SensitiveQueryError', message: 'op failed' });
    expect(pgErrorCode(error)).toBeUndefined();
  });
});
