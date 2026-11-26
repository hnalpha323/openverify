/**
 * A compromised or broken child, for the pool's tests: it starts under the same flags as the real
 * one and sends what a real one never would, on the real pipes. Never shipped to run.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { Worker } from 'node:worker_threads';

const VARIANT = '@jitl/quickjs-wasmfile-release-sync@0.32.0';
const mode = process.argv[3];
const canaryFile = process.argv[4];

const requests = new Socket({ fd: 3, readable: true, writable: false });
const responses = new Socket({ fd: 4, readable: false, writable: true });

const headerOf = (length) => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(length);
  return header;
};
const sendBytes = (payload) => responses.write(Buffer.concat([headerOf(payload.length), payload]));
const send = (frame) => sendBytes(Buffer.from(JSON.stringify(frame), 'utf8'));
const sendReady = () => send({ kind: 'ready', protocol: 1, variant: VARIANT });

const flood = () => {
  const chunk = Buffer.alloc(1024 * 1024, 0x78);
  const push = () => {
    while (responses.write(chunk));
    responses.once('drain', push);
  };
  push();
};

const nested = (depth) => {
  let value = 1;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
};

const refusal = (run) => {
  try {
    run();
    return null;
  } catch (error) {
    return error.code;
  }
};

const probe = () => ({
  env: Object.keys(process.env),
  ipc: typeof process.send,
  read: refusal(() => readFileSync(canaryFile)),
  write: refusal(() => writeFileSync(`${canaryFile}.written`, 'x')),
  spawn: refusal(() => spawnSync('/bin/true')),
  worker: refusal(() => new Worker('0', { eval: true })),
  addon: refusal(() => process.dlopen({ exports: {} }, '/nonexistent.node')),
  permission: process.permission?.has('fs.read', canaryFile),
});

/** What each mode does on the first request; the id comes from the request. */
const onRequest = {
  ok: (id) => send({ kind: 'value', id, value: 1 }),
  'ignore-shutdown': (id) => send({ kind: 'value', id, value: 1 }),
  probe: (id) => send({ kind: 'value', id, value: probe() }),
  spin: () => {
    for (;;);
  },
  silent: () => undefined,
  exit: () => process.exit(3),
  'header-1gib': () => {
    responses.write(headerOf(1024 * 1024 * 1024));
    flood();
  },
  'not-json': () => sendBytes(Buffer.from('{"kind":', 'utf8')),
  'not-utf8': () => sendBytes(Buffer.from([0x22, 0xff, 0x22])),
  'too-deep': (id) => send({ kind: 'value', id, value: nested(40) }),
  'empty-frame': () => responses.write(headerOf(0)),
  'wrong-id': () => send({ kind: 'value', id: '00000000-0000-4000-8000-00000000dead', value: 1 }),
  'wrong-kind': (id) => send({ kind: 'eval', id }),
  'extra-member': (id) => send({ kind: 'value', id, value: 1, stack: 'host' }),
  'parent-code': (id) => send({ kind: 'error', id, code: 'sandbox_crashed', message: null }),
  crashed: (id) => send({ kind: 'crashed', id, reason: 'child_exited' }),
  'second-ready': () => sendReady(),
  'console-flood': (id) => {
    for (let index = 0; index < 51; index += 1) send({ kind: 'console', id, line: 'x' });
    send({ kind: 'value', id, value: 1 });
  },
  'long-console-line': (id) => send({ kind: 'console', id, line: 'x'.repeat(1025) }),
  'long-message': (id) =>
    send({ kind: 'error', id, code: 'runtime_error', message: 'é'.repeat(2000) }),
  polluted: (id) => {
    const text = `{"kind":"value","id":"${id}","value":{"__proto__":{"polluted":true},"kept":1}}`;
    sendBytes(Buffer.from(text, 'utf8'));
  },
  'answer-twice': (id) => {
    send({ kind: 'value', id, value: 1 });
    send({ kind: 'value', id, value: 2 });
  },
  'frame-after-answer': (id) => {
    send({ kind: 'value', id, value: 1 });
    setTimeout(() => send({ kind: 'console', id, line: 'late' }), 20);
  },
};

/** What each mode does at start, before or instead of `ready`. */
const onStart = {
  'no-ready': () => undefined,
  'wrong-variant': () => send({ kind: 'ready', protocol: 1, variant: 'other@1.0.0' }),
  'wrong-protocol': () => send({ kind: 'ready', protocol: 2, variant: VARIANT }),
  'exit-at-start': () => process.exit(66),
  'value-at-start': () =>
    send({ kind: 'value', id: '00000000-0000-4000-8000-000000000001', value: 1 }),
  'garbage-at-start': () => responses.write(Buffer.from([0xff, 0xff, 0xff, 0xff])),
};

let pending = Buffer.alloc(0);
requests.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  for (;;) {
    if (pending.length < 4) return;
    const length = pending.readUInt32BE(0);
    if (pending.length < 4 + length) return;
    const request = JSON.parse(pending.subarray(4, 4 + length).toString('utf8'));
    pending = pending.subarray(4 + length);
    if (request.kind === 'shutdown') {
      if (mode === 'ignore-shutdown') continue;
      process.exit(0);
    }
    onRequest[mode]?.(request.id);
  }
});
requests.on('close', () => process.exit(0));
requests.on('error', () => process.exit(0));
responses.on('error', () => process.exit(0));

const start = onStart[mode] ?? sendReady;
start();
