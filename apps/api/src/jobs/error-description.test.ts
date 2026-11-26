/**
 * Workflow 4B review H001: a job failure is described by its class and code, never by a message
 * that can hold data. Every value here is synthetic.
 */
import { DomainError } from '@openverify/core';
import { SensitiveQueryError } from '@openverify/db';
import { UnrecoverableError } from 'bullmq';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { VisionServiceError } from '../vision/index.js';
import { DescribedJobError, describeJobError, withoutJobData } from './error-description.js';
import { PermanentJobError } from './errors.js';

const SECRET = 'person@example.test';
const serverError = (code: string) =>
  Object.assign(new Error(`invalid input syntax: "${SECRET}"`), { code, severity: 'ERROR' });

describe('describeJobError', () => {
  it.each([
    [
      new UnrecoverableError('ZodError: data does not satisfy a contract'),
      'ZodError: data does not satisfy a contract',
    ],
    [new PermanentJobError('file_missing'), 'The job cannot succeed (file_missing)'],
    [new VisionServiceError('/v1/embed/face', 503), 'Vision service answered 503 (/v1/embed/face)'],
    [
      new SensitiveQueryError('createSelfieBackground', '23505'),
      'createSelfieBackground failed (SQLSTATE 23505)',
    ],
    [new ZodError([]), 'ZodError: data does not satisfy a contract'],
    [new DomainError('invalid_face_embedding', SECRET), 'DomainError: invalid_face_embedding'],
    [
      new DrizzleQueryError('select $1', [SECRET], serverError('22P02')),
      'DrizzleQueryError: the query failed (SQLSTATE 22P02)',
    ],
    [
      new DrizzleQueryError('select $1', [SECRET], new Error('reset')),
      'DrizzleQueryError: the query failed',
    ],
    [
      Object.assign(new Error(`connect ${SECRET}`), { code: 'ECONNREFUSED' }),
      'Error (ECONNREFUSED)',
    ],
    [Object.assign(new TypeError(SECRET), { code: `${SECRET} not a code` }), 'TypeError'],
    [SECRET, 'string'],
    [null, 'object'],
  ])('describes %s without data', (error, description) => {
    expect(describeJobError(error)).toBe(description);
  });
});

describe('withoutJobData', () => {
  it('keeps an error whose message is safe as it is', () => {
    const error = new PermanentJobError('file_missing');
    expect(withoutJobData(error)).toBe(error);
  });

  it('rethrows any other error with the same name, its description and its stack frames', () => {
    const error = new DrizzleQueryError(
      'select $1',
      [`${SECRET}\n    at fake`],
      serverError('57014'),
    );
    const safe = withoutJobData(error);

    expect(safe).toBeInstanceOf(DescribedJobError);
    expect(safe.name).toBe('Error');
    expect(safe.message).toBe('DrizzleQueryError: the query failed (SQLSTATE 57014)');
    expect(safe.stack).toMatch(
      /^Error: DrizzleQueryError: the query failed \(SQLSTATE 57014\)\n {4}at .*error-description\.test\.ts/,
    );
    expect(`${safe.message}${safe.stack ?? ''}`).not.toContain(SECRET);
    expect(safe.cause).toBeUndefined();
    expect(describeJobError(safe)).toBe(safe.message);
  });

  it('keeps no frames when the stack does not start with the message', () => {
    const error = new Error(SECRET);
    error.stack = `Something else\n${SECRET}\n    at frame`;
    expect(withoutJobData(error).stack).toBe('Error: Error');
    const empty = new Error('');
    expect(withoutJobData(empty).stack).toBe('Error: Error');
  });

  it('describes a thrown value that is not an error', () => {
    const safe = withoutJobData(SECRET);
    expect(safe).toMatchObject({ name: 'Error', message: 'string', stack: 'Error: string' });
  });
});
