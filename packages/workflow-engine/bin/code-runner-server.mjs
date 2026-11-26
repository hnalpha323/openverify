/**
 * C123.3 (P17): the entry of the `code-runner` container. It holds no secret and no network: it
 * serves the child pool on a Unix socket on a volume shared with the worker. `--health` is the
 * container's health check: it connects and reads the handshake, so it binds no child to an
 * environment. It imports the build, which only the image is sure to hold.
 *
 * C263.6 (Phase 11, Workflow 11C): with `OPENVERIFY_CODE_RUNNER_LISTEN=<host>:<port>` it listens on
 * TCP instead (the chart's own Deployment, with no egress), and every connection, its health check
 * included, proves `OPENVERIFY_CODE_RUNNER_TOKEN` (or `OPENVERIFY_CODE_RUNNER_TOKEN_FILE`, at least
 * 32 bytes) in its first frame. The token is never printed.
 */
import { readFileSync, statSync } from 'node:fs';
import { connect } from 'node:net';

const DEFAULT_SOCKET = '/run/code-runner/code-runner.sock';
const HEALTH_TIMEOUT_MS = 5_000;

const socketPath = process.env.OPENVERIFY_CODE_RUNNER_SOCKET ?? DEFAULT_SOCKET;
const listenValue = process.env.OPENVERIFY_CODE_RUNNER_LISTEN?.trim() ?? '';

/** A container's memory limit can hold fewer children than it has CPUs. */
function poolSize() {
  const size = Number.parseInt(process.env.OPENVERIFY_CODE_RUNNER_POOL_SIZE ?? '', 10);
  return Number.isInteger(size) && size >= 1 ? { size } : {};
}

/** The tcp: listen address and token, or exit 1 naming the variable (never a value). */
async function tcpSettings() {
  const { parseCodeRunnerTcpTarget, readCodeRunnerToken } =
    await import('../dist/code-runner/index.js');
  const listen = parseCodeRunnerTcpTarget(listenValue);
  const read = readCodeRunnerToken(process.env, {
    readFile: (path) => readFileSync(path, 'utf8'),
    mode: (path) => statSync(path).mode,
  });
  const issues = [...read.issues];
  if (listen === null) issues.push('OPENVERIFY_CODE_RUNNER_LISTEN: must be <host>:<port>');
  if (read.token === null && read.issues.length === 0) {
    issues.push('OPENVERIFY_CODE_RUNNER_TOKEN: is required with OPENVERIFY_CODE_RUNNER_LISTEN');
  }
  if (issues.length > 0) {
    process.stderr.write(`The code runner's configuration is not valid:\n${issues.join('\n')}\n`);
    process.exit(1);
  }
  for (const warning of read.warnings) process.stdout.write(`${JSON.stringify(warning)}\n`);
  return { listen, token: read.token };
}

/** One length-prefixed JSON frame, as the runner's frames are. */
function frame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

async function checkHealth() {
  let socket;
  if (listenValue === '') {
    socket = connect(socketPath);
  } else {
    const { listen, token } = await tcpSettings();
    const host = listen.host === '0.0.0.0' || listen.host === '::' ? '127.0.0.1' : listen.host;
    socket = connect({ host, port: listen.port });
    socket.write(frame({ kind: 'auth', token }));
  }
  const end = (code) => {
    socket.destroy();
    process.exit(code);
  };
  socket.setTimeout(HEALTH_TIMEOUT_MS, () => {
    end(1);
  });
  socket.on('error', () => {
    end(1);
  });
  socket.on('close', () => {
    end(1);
  });
  socket.once('data', () => {
    end(0);
  });
}

async function serve() {
  const { serveCodeRunner } = await import('../dist/code-runner/index.js');
  let server;
  if (listenValue === '') {
    server = await serveCodeRunner({ socketPath, ...poolSize() });
  } else {
    const { listen, token } = await tcpSettings();
    server = await serveCodeRunner({ listen: { ...listen, token }, ...poolSize() });
  }
  const stop = () => {
    void server.close().then(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv.includes('--health')) {
  await checkHealth();
} else {
  await serve();
}
