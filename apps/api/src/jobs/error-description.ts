/**
 * What a job failure may say wherever it is kept: a worker log line, BullMQ's `failedReason` and
 * stack trace in Valkey (failed jobs are kept a week), a command's stderr.
 *
 * Workflow 4B review H001: Drizzle's `DrizzleQueryError` puts every query parameter into its
 * message (a background layout, an email address), and a driver's message can quote a value. So
 * an error is described by its class and its code (a SQLSTATE, or a Node code such as
 * `ECONNREFUSED`), never by its message, unless its class builds its message from codes,
 * endpoints and statuses only.
 */
import { DomainError } from '@openverify/core';
import { SensitiveQueryError, pgErrorCode } from '@openverify/db';
import { UnrecoverableError } from 'bullmq';
import { DrizzleQueryError } from 'drizzle-orm';
import { ZodError } from 'zod';
import { VisionError } from '../vision/index.js';
import { PermanentJobError } from './errors.js';

/** A job failure rethrown with its description as its message: no data, no cause. */
export class DescribedJobError extends Error {
  constructor(name: string, description: string, frames: string) {
    super(description);
    this.name = name;
    this.stack = `${name}: ${description}${frames}`;
  }
}

/** Node system and client codes, such as `ECONNREFUSED`: names, never values. */
const NODE_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;

/** Errors whose messages are built from codes, endpoints and statuses only. */
function hasSafeMessage(error: unknown): error is Error {
  return (
    error instanceof DescribedJobError ||
    // The worker builds its UnrecoverableErrors from describeJobError; BullMQ's carry no data.
    error instanceof UnrecoverableError ||
    error instanceof PermanentJobError ||
    error instanceof VisionError ||
    error instanceof SensitiveQueryError
  );
}

function codeSuffix(error: unknown): string {
  const sqlState = pgErrorCode(error);
  if (sqlState !== undefined) {
    return ` (SQLSTATE ${sqlState})`;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && NODE_CODE.test(code) ? ` (${code})` : '';
}

/** A job failure in words that carry no data: its class and code, or a safe message. */
export function describeJobError(error: unknown): string {
  if (hasSafeMessage(error)) {
    return error.message;
  }
  if (error instanceof ZodError) {
    return 'ZodError: data does not satisfy a contract';
  }
  if (error instanceof DomainError) {
    return `${error.name}: ${error.code}`;
  }
  if (error instanceof DrizzleQueryError) {
    return `DrizzleQueryError: the query failed${codeSuffix(error)}`;
  }
  const name = error instanceof Error ? error.name : typeof error;
  return `${name}${codeSuffix(error)}`;
}

/**
 * The stack frames below the header `<name>: <message>`, or none when the stack does not start
 * with that header (the message, which can span lines, is never kept).
 */
function framesOf(error: Error): string {
  const stack = error.stack ?? '';
  const end = error.message === '' ? -1 : stack.indexOf(`: ${error.message}\n`);
  return end >= 0 && /^[\w$]+$/.test(stack.slice(0, end))
    ? stack.slice(end + error.message.length + 2)
    : '';
}

/**
 * The error to hand BullMQ (which keeps its message and stack): `error` itself when its message
 * is safe, else a {@link DescribedJobError} with the same name, the description and the original
 * stack frames.
 */
export function withoutJobData(error: unknown): Error {
  if (hasSafeMessage(error)) {
    return error;
  }
  return error instanceof Error
    ? new DescribedJobError(error.name, describeJobError(error), framesOf(error))
    : new DescribedJobError('Error', describeJobError(error), '');
}
