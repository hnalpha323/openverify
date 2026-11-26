import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PERSONAL_LOG_KEYS } from '../logger.js';
import { WORKER_REDACT_PATHS, createWorkerLogger } from './logger.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
      callback();
    },
  });
  return { lines, destination };
}

/** `value` under `key`, nested `depth` objects deep. */
function nested(key: string, value: string, depth: number): Record<string, unknown> {
  let object: Record<string, unknown> = { [key]: value };
  for (let level = depth; level > 0; level -= 1) {
    object = { [`level${String(level)}`]: object };
  }
  return object;
}

describe('the worker logger and the Phase 5 personal names (C53.8)', () => {
  it.each(PERSONAL_LOG_KEYS.flatMap((key) => [0, 1, 2, 3].map((depth) => [key, depth] as const)))(
    'redacts %s at depth %i',
    (key, depth) => {
      const { lines, destination } = capture();
      const secret = `synthetic-${key}-${String(depth)}`;

      createWorkerLogger({ destination }).info(nested(key, secret, depth), 'line');

      expect(JSON.stringify(lines)).not.toContain(secret);
    },
  );

  it('keeps a logged error message and code', () => {
    const { lines, destination } = capture();
    const error = Object.assign(new Error('Synthetic RPC failure'), { code: 'rpc_timeout' });

    createWorkerLogger({ destination }).error({ err: error, code: 'outer_code' }, 'failed');

    expect(lines[0]).toMatchObject({
      err: { message: 'Synthetic RPC failure', code: 'rpc_timeout' },
      code: 'outer_code',
    });
  });
});

describe('createWorkerLogger', () => {
  it('writes JSON lines named after the worker', () => {
    const { lines, destination } = capture();
    createWorkerLogger({ destination }).info({ verificationId: 'ver_X' }, 'processed');
    expect(lines).toEqual([
      expect.objectContaining({
        name: 'openverify-worker',
        level: 30,
        verificationId: 'ver_X',
        msg: 'processed',
      }),
    ]);
  });

  it('takes the name of another process that logs outside a request', () => {
    const { lines, destination } = capture();
    createWorkerLogger({ name: 'openverify-api', destination }).error({}, 'lost');
    expect(lines).toEqual([expect.objectContaining({ name: 'openverify-api', msg: 'lost' })]);
  });

  it('redacts embeddings, image bytes, secrets, bodies and credentials at any depth', () => {
    const { lines, destination } = capture();
    const logger = createWorkerLogger({ destination, level: 'warn' });
    logger.warn(
      {
        embedding: [0.123_456],
        face: { embedding: [0.654_321] },
        image: { bytes: 'AAEC', file: { ciphertext: 'BBBB' } },
        webhook: { secret: 'wbhsec_synthetic', request: { body: '{"data":{}}' } },
        headers: { authorization: 'Bearer ovs_synthetic' },
        pii: { name: 'Synthetic Person' },
      },
      'attempt',
    );
    const line = JSON.stringify(lines);
    for (const value of ['0.123456', '0.654321', 'AAEC', 'BBBB', 'wbhsec_synthetic', 'ovs_']) {
      expect(line).not.toContain(value);
    }
    expect(line).not.toContain('{\\"data\\"');
    expect(line).not.toContain('Synthetic Person');
    expect(lines[0]).toMatchObject({ embedding: '[REDACTED]', face: { embedding: '[REDACTED]' } });
  });

  it('redacts selfie device snapshots, camera labels, landmarks and layouts at any depth (C40.5)', () => {
    const { lines, destination } = capture();
    createWorkerLogger({ destination }).info(
      {
        device: { label: 'Synthetic Person iPhone Camera', webdriver: false },
        capture: { device: { label: 'Synthetic Camera Two' } },
        snapshot: { label: 'Synthetic Camera Three' },
        face: { landmarks: [[12.5, 34.25]] },
        background: { layout: [41.75] },
      },
      'selfie',
    );
    const line = JSON.stringify(lines);
    for (const value of ['Synthetic Person', 'Synthetic Camera', '12.5', '34.25', '41.75']) {
      expect(line).not.toContain(value);
    }
    expect(lines[0]).toMatchObject({
      device: '[REDACTED]',
      capture: { device: '[REDACTED]' },
      snapshot: { label: '[REDACTED]' },
    });
  });

  it('respects the level', () => {
    const { lines, destination } = capture();
    createWorkerLogger({ destination, level: 'error' }).info({}, 'ignored');
    expect(lines).toEqual([]);
  });

  it('lists the redacted keys for every depth', () => {
    expect(WORKER_REDACT_PATHS).toContain('*.*.*.embedding');
    expect(WORKER_REDACT_PATHS).toContain('secret');
  });

  it('logs to stdout by default', () => {
    expect(() => createWorkerLogger()).not.toThrow();
  });
});
