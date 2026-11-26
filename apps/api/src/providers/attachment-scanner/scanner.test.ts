/**
 * C135.5 (Workflow 8B Stage 3, `api-case-files`; decision 66, P23, H20): the attachment scanner's
 * providers.
 *
 * - `sandbox` is deterministic: bytes holding the EICAR test string read `infected`, anything else
 *   `clean`; it is a sandbox provider, refused for production by the binding's rule (tested there).
 * - `clamd` speaks our own `INSTREAM` client to an operator-run clamd, here a fake on a local Unix
 *   socket and on loopback TCP that answers what clamd answers: only `stream: OK` reads `clean`, a
 *   `FOUND` answer reads `infected`, and everything else (a size-limit refusal, an unknown answer, a
 *   closed connection, silence past the timeout, nothing listening) reads `error`, never `clean`.
 *
 * No real clamd and no network: the fake listens on this machine alone. Every value is synthetic.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAttachmentScanner } from './index.js';

/** The EICAR test string, put together here so that no file holds it whole. */
const EICAR = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$',
  'EICAR-STANDARD-ANTIVIRUS-',
  'TEST-FILE!$H+H*',
].join('');

const ATTACHMENT = 'catt_01M6FQZCV622MRCK2ZKC7F4HD9';
/** A synthetic PNG signature and a few bytes. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const withEicar = () => new Uint8Array([...PNG, ...Buffer.from(EICAR, 'latin1')]);

describe('the sandbox scanner (C135.5)', () => {
  const scanner = createAttachmentScanner('sandbox', { clamdSocket: null });

  it('reads the EICAR string as infected and anything else as clean, naming itself', async () => {
    expect(scanner.provider).toBe('sandbox');
    await expect(scanner.scan({ attachmentId: ATTACHMENT, bytes: PNG })).resolves.toEqual({
      verdict: 'clean',
      provider: 'sandbox',
    });
    await expect(scanner.scan({ attachmentId: ATTACHMENT, bytes: withEicar() })).resolves.toEqual({
      verdict: 'infected',
      provider: 'sandbox',
    });
  });
});

/** What the fake clamd received, and how it answers one connection. */
interface FakeClamd {
  address: string;
  received: Buffer[];
  close(): Promise<void>;
}

/** Ends the connection without an answer, or keeps it open without one. */
const CLOSE = Symbol('close');
const SILENCE = Symbol('silence');

type Answer = (stream: Buffer) => string | typeof CLOSE | typeof SILENCE;

/** Reads `zINSTREAM\0`, then length-prefixed chunks to a zero length, as clamd does. */
function parseInstream(data: Buffer): Buffer | null {
  const command = Buffer.from('zINSTREAM\0');
  if (data.length < command.length || !data.subarray(0, command.length).equals(command)) {
    return null;
  }
  const chunks: Buffer[] = [];
  let offset = command.length;
  while (offset + 4 <= data.length) {
    const size = data.readUInt32BE(offset);
    offset += 4;
    if (size === 0) {
      return Buffer.concat(chunks);
    }
    if (offset + size > data.length) {
      return null;
    }
    chunks.push(data.subarray(offset, offset + size));
    offset += size;
  }
  return null;
}

const directories: string[] = [];
const servers: FakeClamd[] = [];

async function fakeClamd(answer: Answer, transport: 'unix' | 'tcp' = 'unix'): Promise<FakeClamd> {
  const received: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let data = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      const stream = parseInstream(data);
      if (stream === null) {
        return;
      }
      received.push(stream);
      const reply = answer(stream);
      if (reply === CLOSE) {
        socket.destroy();
      } else if (reply !== SILENCE) {
        socket.end(`${reply}\0`);
      }
    });
  });
  let address: string;
  if (transport === 'unix') {
    const directory = mkdtempSync(join(tmpdir(), 'clamd-'));
    directories.push(directory);
    address = join(directory, 'clamd.sock');
    await new Promise<void>((resolve) => server.listen(address, resolve));
  } else {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    address = `127.0.0.1:${String(port)}`;
  }
  const fake = {
    address,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => {
          resolve();
        });
      }),
  };
  servers.push(fake);
  return fake;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const clamdAnswer: Answer = (stream) =>
  stream.includes(Buffer.from(EICAR, 'latin1'))
    ? 'stream: Win.Test.EICAR_HDB-1 FOUND'
    : 'stream: OK';

describe('the clamd scanner (C135.5)', () => {
  it('streams the bytes over INSTREAM and reads OK as clean and FOUND as infected', async () => {
    const clamd = await fakeClamd(clamdAnswer);
    const scanner = createAttachmentScanner('clamd', { clamdSocket: clamd.address });
    const large = new Uint8Array(200_000).map((_, index) => index % 251);

    expect(scanner.provider).toBe('clamd');
    await expect(scanner.scan({ attachmentId: ATTACHMENT, bytes: large })).resolves.toEqual({
      verdict: 'clean',
      provider: 'clamd',
    });
    await expect(scanner.scan({ attachmentId: ATTACHMENT, bytes: withEicar() })).resolves.toEqual({
      verdict: 'infected',
      provider: 'clamd',
    });
    expect(clamd.received[0]?.equals(Buffer.from(large))).toBe(true);
  });

  it('reaches clamd over a private address too', async () => {
    const clamd = await fakeClamd(clamdAnswer, 'tcp');
    const scanner = createAttachmentScanner('clamd', { clamdSocket: clamd.address });

    await expect(scanner.scan({ attachmentId: ATTACHMENT, bytes: PNG })).resolves.toEqual({
      verdict: 'clean',
      provider: 'clamd',
    });
  });

  it.each([
    ['a size-limit refusal', 'INSTREAM size limit exceeded. ERROR'],
    ['an unknown answer', 'stream: OK and something else'],
    ['an error answer', 'stream: lstat() failed: Permission denied. ERROR'],
  ])('reads %s as error, never clean', async (_name, reply) => {
    const clamd = await fakeClamd(() => reply);
    const scanner = createAttachmentScanner('clamd', { clamdSocket: clamd.address });

    await expect(scanner.scan({ attachmentId: ATTACHMENT, bytes: PNG })).resolves.toEqual({
      verdict: 'error',
      provider: 'clamd',
    });
  });

  it('reads a closed connection, silence past the timeout and nothing listening as error', async () => {
    const closing = await fakeClamd(() => CLOSE);
    const silent = await fakeClamd(() => SILENCE);
    const scan = (socket: string) =>
      createAttachmentScanner('clamd', { clamdSocket: socket, clamdTimeoutMs: 200 }).scan({
        attachmentId: ATTACHMENT,
        bytes: PNG,
      });

    await expect(scan(closing.address)).resolves.toEqual({ verdict: 'error', provider: 'clamd' });
    await expect(scan(silent.address)).resolves.toEqual({ verdict: 'error', provider: 'clamd' });
    await expect(scan(join(tmpdir(), 'no-clamd-here.sock'))).resolves.toEqual({
      verdict: 'error',
      provider: 'clamd',
    });
  });

  it('refuses to bind without its socket', () => {
    expect(() => createAttachmentScanner('clamd', { clamdSocket: null })).toThrow(
      'clamd needs its socket',
    );
  });
});
