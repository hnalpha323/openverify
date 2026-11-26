/**
 * Playwright global setup: starts the e2e stack, hands its URLs and seeded credentials to the
 * specs through an environment variable, and returns the teardown that stops everything. With
 * `OPENVERIFY_E2E_REUSE_STACK=1` it starts nothing: it hands over the stack `e2e:stack:up` started
 * (C111.2), which `e2e:stack:down` ends, so each shard runs against the one stack.
 */
import { readFile } from 'node:fs/promises';
import {
  REUSABLE_STACK_FILE,
  processAlive,
  readReusableStack,
  reuseRequested,
} from '../src/reusable-stack.js';
import { encodeStackInfo, STACK_INFO_ENV } from '../src/stack-info.js';
import { startStack } from './stack.js';

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (reuseRequested(process.env)) {
    const record = await readFile(REUSABLE_STACK_FILE, 'utf8').catch(() => undefined);
    const info = readReusableStack(record, (pid) =>
      processAlive(pid, (target, signal) => process.kill(target, signal)),
    );
    process.env[STACK_INFO_ENV] = encodeStackInfo(info);
    return () => Promise.resolve();
  }
  const stack = await startStack();
  process.env[STACK_INFO_ENV] = encodeStackInfo(stack.info);
  return () => stack.stop();
}
