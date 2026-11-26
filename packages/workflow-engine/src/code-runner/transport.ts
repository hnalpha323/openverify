/**
 * C263.6 (Workflow 11C Stage 1a, contracts-11c): the code runner's `tcp:` transport, frozen. In a
 * cluster the runner is its own Deployment with no egress, and the worker reaches it at
 * `OPENVERIFY_WORKFLOW_CODE_RUNNER=tcp:<host>:<port>` with a shared token
 * (`OPENVERIFY_CODE_RUNNER_TOKEN`, at least 32 bytes, a secret of both processes); the runner
 * listens on `OPENVERIFY_CODE_RUNNER_LISTEN` (`<host>:<port>`) instead of its socket. The request
 * limits are the socket's (`REQUEST_FRAME_MAX_BYTES`, `evaluateRequestAllowed`). images-11c builds
 * the client and the listener beside the socket ones (a named borrowed edit of Phase 8's runner).
 */
import { isIPv4, isIPv6 } from 'node:net';
import type { CodeRunner } from './runner.js';
import { createTcpRunner } from './socket-client.js';

/** The runner's listen address for the `tcp:` transport (`<host>:<port>`). */
export const CODE_RUNNER_LISTEN_VARIABLE = 'OPENVERIFY_CODE_RUNNER_LISTEN';
/** The token both ends hold for the `tcp:` transport. */
export const CODE_RUNNER_TOKEN_VARIABLE = 'OPENVERIFY_CODE_RUNNER_TOKEN';
/** The token's least length, in UTF-8 bytes. */
export const CODE_RUNNER_TOKEN_MIN_BYTES = 32;

/** A `tcp:` target or listen address. */
export interface CodeRunnerTcpTarget {
  /** A DNS name, an IPv4 address, or an IPv6 address without its brackets. */
  host: string;
  /** 1 to 65,535. */
  port: number;
}

/** A DNS label: letters, digits and inner hyphens, at most 63 characters. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
/** `[<IPv6>]:<port>` or `<host>:<port>`, the port without a sign or a leading zero. */
const TARGET = /^(?:\[([^\]]+)\]|([^:[\]]+)):([1-9]\d{0,4})$/;

/** `<host>:<port>` (an IPv6 host in brackets), or `null` for anything else. */
export function parseCodeRunnerTcpTarget(value: string): CodeRunnerTcpTarget | null {
  const match = TARGET.exec(value);
  if (match === null) {
    return null;
  }
  const port = Number(match[3]);
  if (port > 65_535) {
    return null;
  }
  const [, bracketed, plain = ''] = match;
  if (bracketed !== undefined) {
    return isIPv6(bracketed) ? { host: bracketed, port } : null;
  }
  if (isIPv4(plain)) {
    return { host: plain, port };
  }
  return plain.length <= 253 && plain.split('.').every((label) => DNS_LABEL.test(label))
    ? { host: plain, port }
    : null;
}

/**
 * The `tcp:` client, beside `connectCodeRunner` (the socket form): the socket's client over TCP, its
 * first frame the token (images-11c).
 * @throws {TypeError} for a token under 32 bytes, naming the variable and never the value.
 */
export const connectCodeRunnerOverTcp: (
  target: CodeRunnerTcpTarget & { token: string },
) => CodeRunner = (target) => {
  if (Buffer.byteLength(target.token, 'utf8') < CODE_RUNNER_TOKEN_MIN_BYTES) {
    throw new TypeError(
      `${CODE_RUNNER_TOKEN_VARIABLE} must be at least ${String(CODE_RUNNER_TOKEN_MIN_BYTES)} bytes`,
    );
  }
  return createTcpRunner(target);
};
