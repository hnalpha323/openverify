/**
 * Starting and stopping the e2e stack's processes. Each service runs in its own process group
 * (`detached`), so stopping it also stops what it started: `pnpm exec` spawns `tsx`, which
 * spawns node; `uv run` spawns uvicorn. Output goes to a log file per service.
 */
import { spawn } from 'node:child_process';
import { closeSync, createWriteStream, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ServiceOptions {
  name: string;
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** stdout and stderr are appended here. */
  logFile: string;
}

export interface Service {
  readonly name: string;
  readonly pid: number;
  readonly logFile: string;
  /** `undefined` while running; `null` when ended by a signal or when it could not start. */
  readonly exitCode: number | null | undefined;
  /** Settles with the exit code once the process has ended. */
  readonly exited: Promise<number | null>;
  /**
   * Sends SIGTERM to the process group, then SIGKILL to whatever is left after `graceMs`.
   * Safe to call more than once and after the process has ended.
   */
  stop(graceMs?: number): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Signals a whole process group; false when the group no longer exists. */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** The last `lines` lines of `text`, without a trailing newline. */
export function tail(text: string, lines: number): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n');
}

export function startService(options: ServiceOptions): Service {
  const log = openSync(options.logFile, 'a');
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);

  let exitCode: number | null | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      exitCode = code;
      resolve(code);
    });
    child.once('error', () => {
      exitCode = null;
      resolve(null);
    });
  });
  const pid = child.pid ?? -1;

  return {
    name: options.name,
    pid,
    logFile: options.logFile,
    get exitCode() {
      return exitCode;
    },
    exited,
    async stop(graceMs = 10_000) {
      if (pid < 0) {
        return;
      }
      signalGroup(pid, 'SIGTERM');
      const deadline = Date.now() + graceMs;
      while (Date.now() < deadline && signalGroup(pid, 0)) {
        await sleep(50);
      }
      signalGroup(pid, 'SIGKILL');
      await exited;
    },
  };
}

const hasExited = (service: Service | undefined): service is Service =>
  service?.exitCode !== undefined;

async function exitedEarly(service: Service): Promise<Error> {
  const log = await readFile(service.logFile, 'utf8').catch(() => '');
  return new Error(
    `${service.name} exited with code ${String(service.exitCode)} before it was ready. ` +
      `Last lines of ${service.logFile}:\n${tail(log, 30)}`,
  );
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
}

/**
 * Polls `url` until it answers 2xx.
 * @throws {Error} after `timeoutMs`, or at once when `service` exits first.
 */
export async function waitForHttp(
  url: string,
  options: WaitOptions & { service?: Service },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (hasExited(options.service)) {
      throw await exitedEarly(options.service);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      await response.body?.cancel();
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) {
      throw new Error(`${url} did not answer 2xx within ${String(options.timeoutMs)} ms`);
    }
    await sleep(options.intervalMs ?? 250);
  }
}

/**
 * Polls the service's log until a line matches `pattern`.
 * @throws {Error} after `timeoutMs`, or when the service exits without logging it.
 */
export async function waitForLog(
  service: Service,
  pattern: RegExp,
  options: WaitOptions,
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const exitedBefore = service.exitCode !== undefined;
    const log = await readFile(service.logFile, 'utf8').catch(() => '');
    if (pattern.test(log)) {
      return;
    }
    if (exitedBefore) {
      throw await exitedEarly(service);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${service.name} did not log ${String(pattern)} within ${String(options.timeoutMs)} ms`,
      );
    }
    await sleep(options.intervalMs ?? 100);
  }
}

/** A command that failed, timed out or could not start. */
export class CommandError extends Error {
  override name = 'CommandError';
  readonly exitCode: number | null;

  constructor(message: string, exitCode: number | null) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** How much of a streamed output `runCommand` keeps for a failure's message. */
const STREAMED_TAIL_CHARS = 64 * 1024;

export interface RunOptions {
  cwd: string;
  /** Defaults to this process's environment. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Names the step in errors; defaults to the command and its first argument. */
  label?: string;
  /**
   * When set, stdout and stderr are streamed to this file (created or truncated) instead of being
   * returned, and only a bounded tail is kept in memory for a failure's message, so an output of
   * any size (a long-held stack's `docker compose logs`) never reaches V8's string limit.
   */
  outputFile?: string;
}

/**
 * Runs a command to completion and returns its output.
 * @throws {CommandError} on a non-zero exit (with the end of its output), a timeout, or when
 * the command cannot start.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  const label = options.label ?? [path.basename(command), args[0]].filter(Boolean).join(' ');
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    // With outputFile, only the end of the output is kept in memory, for a failure's message.
    let streamedTail = '';
    const file =
      options.outputFile === undefined ? undefined : createWriteStream(options.outputFile);
    if (file === undefined) {
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    } else {
      const keep = (chunk: string) => {
        streamedTail = (streamedTail + chunk).slice(-STREAMED_TAIL_CHARS);
      };
      child.stdout.setEncoding('utf8').on('data', keep).pipe(file, { end: false });
      child.stderr.setEncoding('utf8').on('data', keep).pipe(file, { end: false });
    }
    const closeFile = () =>
      new Promise<void>((done) => {
        if (file === undefined) {
          done();
        } else {
          file.end(() => {
            done();
          });
        }
      });

    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            if (child.pid !== undefined) {
              signalGroup(child.pid, 'SIGKILL');
            }
          }, options.timeoutMs);

    const settle = (code: number | null) => {
      if (timedOut) {
        reject(new CommandError(`${label} timed out after ${String(options.timeoutMs)} ms`, code));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const output = file === undefined ? `${stdout}\n${stderr}` : streamedTail;
        reject(
          new CommandError(
            `${label} failed with exit code ${String(code)}. Last lines:\n${tail(output, 40)}`,
            code,
          ),
        );
      }
    };
    child.once('error', (error) => {
      clearTimeout(timer);
      void closeFile().then(() => {
        reject(new CommandError(`${label} could not start: ${error.message}`, null));
      });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      void closeFile().then(() => {
        settle(code);
      });
    });
  });
}

/**
 * The environment of a stack process or command: `inherited` (this process's, by default)
 * minus what must not leak into it (Playwright's loader in `NODE_OPTIONS` and its `PW_*` and
 * `PLAYWRIGHT_*` settings, compose project selection, test runner variables), plus the run's
 * settings, which win.
 */
export function childEnvironment(
  env: Readonly<Record<string, string>>,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(
    Object.entries(inherited).filter(
      ([name]) =>
        name !== 'NODE_OPTIONS' &&
        !name.startsWith('PW_') &&
        !name.startsWith('PLAYWRIGHT_') &&
        !name.startsWith('COMPOSE_') &&
        !name.startsWith('TEST_'),
    ),
  );
  return { ...kept, ...env, NEXT_TELEMETRY_DISABLED: '1', FORCE_COLOR: '0' };
}
