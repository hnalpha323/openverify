/**
 * C111.2 (F20, Workflow 7A integration-7a): the reusable e2e stack. With the full-stack suite past
 * one 10-minute call, `e2e:stack:up` starts the private stack once (it may run in the background)
 * and records it here; with `OPENVERIFY_E2E_REUSE_STACK=1`, the Playwright global setup reads the
 * record instead of starting a stack, so `playwright test --shard=i/N` runs each shard against the
 * one stack; `e2e:stack:down` ends it. The record holds the run's seeded credentials, so it is
 * written with mode 0600 under the gitignored `e2e/.artifacts/`, beside `e2e/.env.e2e`, which holds
 * the same secrets.
 */
import path from 'node:path';
import { z } from 'zod';
import { ARTIFACTS_DIR } from './paths.js';
import { parseStackInfo, type StackInfo } from './stack-info.js';

/** Set to `1` to run the specs against the stack `e2e:stack:up` started. */
export const REUSE_STACK_ENV = 'OPENVERIFY_E2E_REUSE_STACK';

/** The record of the running reusable stack (gitignored, mode 0600: it holds the run's secrets). */
export const REUSABLE_STACK_FILE = path.join(ARTIFACTS_DIR, 'stack.json');

/** What `e2e:stack:up` records once the stack is ready. */
export interface ReusableStackRecord {
  /** The process that holds the stack and stops it on SIGTERM. */
  pid: number;
  startedAt: string;
  info: StackInfo;
}

const recordSchema = z.strictObject({
  pid: z.int().positive(),
  startedAt: z.iso.datetime(),
  info: z.unknown(),
});

/** Whether the specs run against the reusable stack rather than a stack of their own. */
export function reuseRequested(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env[REUSE_STACK_ENV];
  return value === '1' || value === 'true';
}

export function encodeReusableStack(record: ReusableStackRecord): string {
  return JSON.stringify(record);
}

/** @throws {Error} naming the record, never its content (it holds secrets). */
export function decodeReusableStack(text: string): ReusableStackRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const record = recordSchema.safeParse(parsed);
  const info = record.success ? parseStackInfo(record.data.info) : undefined;
  if (!record.success || info === undefined) {
    throw new Error(
      'the reusable stack record is unreadable: run e2e:stack:down, then e2e:stack:up',
    );
  }
  return { pid: record.data.pid, startedAt: record.data.startedAt, info };
}

/** Whether `pid` is a running process (signal 0 probes without signalling). */
export function processAlive(pid: number, kill: (pid: number, signal: 0) => void): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The stack info the global setup hands to the specs, from the record `text` (`undefined` when
 * there is no record), once its holder is still running.
 */
export function readReusableStack(
  text: string | undefined,
  alive: (pid: number) => boolean,
): StackInfo {
  if (text === undefined) {
    throw new Error(
      'no reusable e2e stack is running: start one with `pnpm --filter @openverify/e2e e2e:stack:up`',
    );
  }
  const record = decodeReusableStack(text);
  if (!alive(record.pid)) {
    throw new Error(
      `the reusable e2e stack (process ${String(record.pid)}) is no longer running: run e2e:stack:down, then e2e:stack:up`,
    );
  }
  return record.info;
}
