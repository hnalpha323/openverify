/**
 * The reusable e2e stack's commands (plan C111.2, F20; e2e/README.md):
 *
 *   pnpm --filter @openverify/e2e e2e:stack:up      start the stack once and record it
 *   OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --shard=1/3
 *   pnpm --filter @openverify/e2e e2e:stack:down    stop it and remove its compose project
 *
 * `up` starts a holder process, detached, that runs `startStack()` (the same private stack the
 * global setup starts: the compose project `openverify-e2e`, the migrations and seed, the builds,
 * and the API, worker, vision, flow and dashboard processes), writes `e2e/.artifacts/stack.json`
 * (mode 0600) once the stack is ready, and stops everything on SIGTERM. `up` itself returns once the
 * record exists, so it can run in the foreground; it fails, with the end of the holder's log, if the
 * holder exits first. `down` signals the holder and waits for it; with no live holder it removes the
 * compose project of a stack whose holder died. A non-reuse run (`playwright test` without
 * `OPENVERIFY_E2E_REUSE_STACK`) takes the same compose project down first, so never run one while a
 * reusable stack is up.
 */
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_COMPOSE_PROJECT, parseEnvFile } from '../src/env.js';
import { composeFileArgs } from '../src/images-mode.js';
import { ARTIFACTS_DIR, ENV_FILE, REPO_ROOT } from '../src/paths.js';
import { childEnvironment, runCommand, tail } from '../src/processes.js';
import {
  REUSABLE_STACK_FILE,
  decodeReusableStack,
  encodeReusableStack,
  processAlive,
  type ReusableStackRecord,
} from '../src/reusable-stack.js';
import { startStack } from './stack.js';

const HOLDER_LOG = path.join(ARTIFACTS_DIR, 'stack-holder.log');
const START_DEADLINE_MS = 25 * 60_000;
const STOP_DEADLINE_MS = 3 * 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number) =>
  processAlive(pid, (target, signal) => {
    process.kill(target, signal);
  });
const say = (message: string) => process.stdout.write(`[e2e:stack] ${message}\n`);

async function currentRecord(): Promise<ReusableStackRecord | undefined> {
  const text = await readFile(REUSABLE_STACK_FILE, 'utf8').catch(() => undefined);
  if (text === undefined) {
    return undefined;
  }
  try {
    return decodeReusableStack(text);
  } catch {
    return undefined;
  }
}

async function up(): Promise<void> {
  const running = await currentRecord();
  if (running !== undefined && alive(running.pid)) {
    say(`already running (holder ${String(running.pid)}, since ${running.startedAt})`);
    return;
  }
  await rm(REUSABLE_STACK_FILE, { force: true });
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const log = openSync(HOLDER_LOG, 'w');
  const holder = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), 'hold'],
    { cwd: process.cwd(), env: process.env, detached: true, stdio: ['ignore', log, log] },
  );
  closeSync(log);
  holder.unref();
  let exitCode: number | null | undefined;
  holder.once('exit', (code) => {
    exitCode = code;
  });
  say(
    `starting the stack (holder ${String(holder.pid)}; log ${path.relative(REPO_ROOT, HOLDER_LOG)})`,
  );
  const deadline = Date.now() + START_DEADLINE_MS;
  while (Date.now() < deadline) {
    const record = await currentRecord();
    if (record !== undefined && record.pid === holder.pid) {
      say(`ready: run the specs with OPENVERIFY_E2E_REUSE_STACK=1; end it with e2e:stack:down`);
      return;
    }
    if (exitCode !== undefined) {
      const text = await readFile(HOLDER_LOG, 'utf8').catch(() => '');
      throw new Error(`the stack holder exited (${String(exitCode)}):\n${tail(text, 40)}`);
    }
    await sleep(2_000);
  }
  throw new Error(`the stack was not ready within ${String(START_DEADLINE_MS / 60_000)} minutes`);
}

async function hold(): Promise<void> {
  const stack = await startStack();
  await writeFile(
    REUSABLE_STACK_FILE,
    encodeReusableStack({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      info: stack.info,
    }),
    { mode: 0o600 },
  );
  const keepAlive = setInterval(() => undefined, 60_000);
  let stopping = false;
  const finish = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    void (async () => {
      await stack.stop();
      await rm(REUSABLE_STACK_FILE, { force: true });
      clearInterval(keepAlive);
      process.exit(0);
    })();
  };
  process.once('SIGTERM', finish);
  process.once('SIGINT', finish);
}

/** Removes the compose project of a stack whose holder is gone (its env file names the ports). */
async function removeOrphanedProject(): Promise<void> {
  const exists = await access(ENV_FILE).then(
    () => true,
    () => false,
  );
  if (!exists) {
    return;
  }
  const env = parseEnvFile(await readFile(ENV_FILE, 'utf8'));
  await runCommand(
    'docker',
    [
      'compose',
      '--project-name',
      E2E_COMPOSE_PROJECT,
      // The images mode's env file names it, so its app containers go down with the project.
      ...composeFileArgs(REPO_ROOT, env),
      '--env-file',
      ENV_FILE,
      'down',
      '--volumes',
      '--remove-orphans',
    ],
    { cwd: REPO_ROOT, env: childEnvironment(env), timeoutMs: 5 * 60_000, label: 'compose down' },
  );
}

async function down(): Promise<void> {
  const record = await currentRecord();
  if (record === undefined || !alive(record.pid)) {
    say('no live holder: removing the compose project of any earlier stack');
    await removeOrphanedProject();
    await rm(REUSABLE_STACK_FILE, { force: true });
    return;
  }
  process.kill(record.pid, 'SIGTERM');
  const deadline = Date.now() + STOP_DEADLINE_MS;
  while (alive(record.pid) && Date.now() < deadline) {
    await sleep(1_000);
  }
  if (alive(record.pid)) {
    process.kill(record.pid, 'SIGKILL');
    await removeOrphanedProject();
  }
  await rm(REUSABLE_STACK_FILE, { force: true });
  say('stopped');
}

const commands: Record<string, () => Promise<void>> = { up, hold, down };
const command = commands[process.argv[2] ?? ''];
if (command === undefined) {
  process.stderr.write('usage: reusable-stack-cli.ts up|down\n');
  process.exitCode = 2;
} else {
  command().catch((error: unknown) => {
    process.stderr.write(`[e2e:stack] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
