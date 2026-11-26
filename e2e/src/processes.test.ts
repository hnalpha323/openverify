import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { freePorts } from './ports.js';
import {
  childEnvironment,
  CommandError,
  runCommand,
  startService,
  tail,
  waitForHttp,
  waitForLog,
  type Service,
} from './processes.js';

const NODE = process.execPath;
let dir: string;
const started: Service[] = [];

function node(name: string, script: string): Service {
  const service = startService({
    name,
    command: NODE,
    args: ['-e', script],
    cwd: dir,
    env: { PATH: process.env.PATH ?? '' },
    logFile: path.join(dir, `${name}.log`),
  });
  started.push(service);
  return service;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met in time');
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'openverify-e2e-processes-'));
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((service) => service.stop(500)));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('startService', () => {
  it('writes the output of the process to its log file', async () => {
    const service = node(
      'echo',
      "console.log('hello from the service'); console.error('and stderr')",
    );

    await expect(service.exited).resolves.toBe(0);
    const log = await readFile(service.logFile, 'utf8');
    expect(log).toContain('hello from the service');
    expect(log).toContain('and stderr');
    expect(service.exitCode).toBe(0);
  });

  it('stops the process and everything it started', async () => {
    const service = node(
      'parent',
      [
        "const { spawn } = require('node:child_process');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        "console.log('grandchild ' + child.pid);",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    );
    await waitForLog(service, /grandchild \d+/, { timeoutMs: 10_000 });
    const grandchild = Number(
      /grandchild (\d+)/.exec(await readFile(service.logFile, 'utf8'))?.[1],
    );
    expect(isAlive(grandchild)).toBe(true);

    await service.stop();

    expect(isAlive(service.pid)).toBe(false);
    await eventually(() => !isAlive(grandchild));
  });

  it('kills a process that ignores SIGTERM once the grace period is over', async () => {
    const service = node(
      'stubborn',
      "process.on('SIGTERM', () => console.log('ignoring SIGTERM')); console.log('up'); setInterval(() => {}, 1000);",
    );
    await waitForLog(service, /up/, { timeoutMs: 10_000 });

    await service.stop(300);

    expect(isAlive(service.pid)).toBe(false);
    expect(await readFile(service.logFile, 'utf8')).toContain('ignoring SIGTERM');
  });

  it('can be stopped again after it has exited', async () => {
    const service = node('short', 'process.exit(0)');
    await service.exited;

    await expect(service.stop()).resolves.toBeUndefined();
  });
});

describe('waitForHttp', () => {
  let server: Server;
  let url: string;
  let unusedUrl: string;
  let answers: number[];

  beforeAll(async () => {
    const [port, unused] = await freePorts(2);
    url = `http://127.0.0.1:${String(port)}/health`;
    unusedUrl = `http://127.0.0.1:${String(unused)}/health`;
    server = createServer((_request, response) => {
      response.statusCode = answers.shift() ?? 200;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('waits until the URL answers 2xx', async () => {
    answers = [503, 503];

    await expect(waitForHttp(url, { timeoutMs: 5_000, intervalMs: 20 })).resolves.toBeUndefined();
    expect(answers).toEqual([]);
  });

  it('gives up after the timeout', async () => {
    await expect(waitForHttp(unusedUrl, { timeoutMs: 200, intervalMs: 20 })).rejects.toThrow(
      `${unusedUrl} did not answer 2xx within 200 ms`,
    );
  });

  it('fails at once with the end of the log when the service exits first', async () => {
    const service = node('crashing', "console.error('boom: missing setting'); process.exit(3)");

    await expect(
      waitForHttp(unusedUrl, { timeoutMs: 10_000, intervalMs: 20, service }),
    ).rejects.toThrow(
      /crashing exited with code 3 before it was ready[\s\S]*boom: missing setting/,
    );
  });
});

describe('waitForLog', () => {
  it('fails when the service exits without writing the line', async () => {
    const service = node('silent', "console.log('something else')");

    await expect(waitForLog(service, /ready/, { timeoutMs: 10_000 })).rejects.toThrow(
      /silent exited with code 0 before it was ready[\s\S]*something else/,
    );
  });

  it('gives up after the timeout', async () => {
    const service = node('slow', 'setInterval(() => {}, 1000)');

    await expect(waitForLog(service, /ready/, { timeoutMs: 200, intervalMs: 20 })).rejects.toThrow(
      'slow did not log /ready/ within 200 ms',
    );
  });
});

describe('runCommand', () => {
  it('returns the output of a successful command', async () => {
    const result = await runCommand(
      NODE,
      ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
      {
        cwd: process.cwd(),
      },
    );

    expect(result).toEqual({ stdout: 'out', stderr: 'err' });
  });

  it('streams the output to outputFile and returns none of it, so no output size is held in one string', async () => {
    // A long-held images-mode stack's `docker compose logs api` passed V8's string limit and
    // killed the holder before its `compose down` (RangeError: Invalid string length).
    const file = path.join(dir, 'streamed.log');
    const line = 'x'.repeat(1023);
    const result = await runCommand(
      NODE,
      [
        '-e',
        `const l = ${JSON.stringify(line)} + '\\n'; for (let i = 0; i < 8192; i++) process.stdout.write(l); process.stderr.write('done\\n');`,
      ],
      { cwd: process.cwd(), outputFile: file },
    );

    expect(result).toEqual({ stdout: '', stderr: '' });
    const written = await readFile(file, 'utf8');
    // stdout and stderr are two pipes, so their order in the file is not asserted.
    expect(written.length).toBe(8192 * 1024 + 'done\n'.length);
    expect(written.split('\n').filter((entry) => entry === line)).toHaveLength(8192);
    expect(written).toContain('done\n');
  });

  it('keeps only the end of a streamed output for a failure', async () => {
    const file = path.join(dir, 'streamed-failure.log');
    const error = await runCommand(
      NODE,
      [
        '-e',
        // exitCode, not exit(): process.exit() may drop what is still queued for a pipe.
        "for (let i = 0; i < 100000; i++) console.log('line ' + i); console.log('it broke'); process.exitCode = 5",
      ],
      { cwd: process.cwd(), outputFile: file, label: 'streamed' },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).exitCode).toBe(5);
    expect((error as CommandError).message).toContain('it broke');
    expect((error as CommandError).message.length).toBeLessThan(70_000);
    expect(await readFile(file, 'utf8')).toContain('line 99999');
  });

  it('passes the environment it is given', async () => {
    const result = await runCommand(
      NODE,
      ['-e', 'process.stdout.write(process.env.E2E_VALUE ?? "")'],
      {
        cwd: process.cwd(),
        env: { ...process.env, E2E_VALUE: 'given' },
      },
    );

    expect(result.stdout).toBe('given');
  });

  it('reports a failure with its exit code and the end of its output', async () => {
    const error = await runCommand(
      NODE,
      ['-e', "console.log('step one'); console.error('it broke'); process.exit(4)"],
      { cwd: process.cwd(), label: 'migrate' },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).exitCode).toBe(4);
    expect((error as CommandError).message).toMatch(
      /migrate failed with exit code 4[\s\S]*it broke/,
    );
  });

  it('stops a command that runs past its timeout', async () => {
    await expect(
      runCommand(NODE, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: process.cwd(),
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/timed out after 200 ms/);
  });

  it('reports a command that cannot start', async () => {
    await expect(
      runCommand(path.join(dir, 'no-such-binary'), [], { cwd: process.cwd() }),
    ).rejects.toThrow(/could not start/);
  });
});

describe('tail', () => {
  it('keeps the last lines', () => {
    expect(tail('a\nb\nc\nd\n', 2)).toBe('c\nd');
    expect(tail('', 3)).toBe('');
  });
});

describe('childEnvironment', () => {
  it("keeps this process's variables except what would redirect the child, then adds the run's", () => {
    const env = childEnvironment(
      { DATABASE_URL: 'postgres://run', PATH: '/run/bin' },
      {
        PATH: '/usr/bin',
        HOME: '/home/synthetic',
        NODE_OPTIONS: '--require playwright-loader',
        PW_TEST_SOURCE: 'x',
        PLAYWRIGHT_BROWSERS_PATH: 'y',
        COMPOSE_PROJECT_NAME: 'openverify',
        TEST_WORKER_INDEX: '0',
      },
    );

    expect(env).toEqual({
      HOME: '/home/synthetic',
      PATH: '/run/bin',
      DATABASE_URL: 'postgres://run',
      NEXT_TELEMETRY_DISABLED: '1',
      FORCE_COLOR: '0',
    });
  });
});
