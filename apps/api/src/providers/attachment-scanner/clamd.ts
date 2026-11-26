/**
 * C135.5 (decision 66, H20): our own client of clamd's `INSTREAM` command, so no GPL code is linked.
 * It sends `zINSTREAM\0`, the bytes as length-prefixed chunks (a 4-byte big-endian length each) and a
 * zero length, then reads clamd's answer up to its `\0`.
 *
 * Only `stream: OK` reads `clean`, and `stream: <signature> FOUND` reads `infected`. Everything else
 * reads `error`, never `clean`: a size-limit refusal (`INSTREAM size limit exceeded. ERROR`), any other
 * answer, a connection that closes or fails, an answer past {@link CLAMD_MAX_ANSWER_BYTES}, and
 * silence past the timeout. The scan job retries an error, at most three attempts in all.
 *
 * Nothing is logged here: the bytes are a person's data, and the answer names a signature at most.
 */
import { connect, type Socket } from 'node:net';

/** Provisional, ours: clamd scans 10 MiB in well under this on an idle host. */
export const CLAMD_TIMEOUT_MS = 30_000;
/** Chunks of 64 KiB, under clamd's default `StreamMaxLength` of 25 MiB in one stream. */
export const CLAMD_CHUNK_BYTES = 64 * 1024;
/** clamd's answers are a line; anything longer is not one of them. */
export const CLAMD_MAX_ANSWER_BYTES = 4096;

const COMMAND = Buffer.from('zINSTREAM\0', 'latin1');
const FOUND = /^stream: \S.* FOUND$/;

/** A Unix socket path, or `host:port` (`[v6]:port` for IPv6). */
function connectTo(address: string): Socket {
  if (address.startsWith('/') || address.startsWith('.')) {
    return connect({ path: address });
  }
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(address);
  if (match === null) {
    return connect({ path: address });
  }
  return connect({ host: match[1] ?? match[2] ?? '', port: Number(match[3]) });
}

/** What clamd's answer means. */
export function verdictOfClamdAnswer(answer: string): 'clean' | 'infected' | 'error' {
  if (answer === 'stream: OK') {
    return 'clean';
  }
  return FOUND.test(answer) ? 'infected' : 'error';
}

/** Scans `bytes` with the clamd at `address`; never rejects. */
export function scanWithClamd(
  address: string,
  bytes: Uint8Array,
  timeoutMs: number,
): Promise<'clean' | 'infected' | 'error'> {
  return new Promise((resolve) => {
    let settled = false;
    let answer = Buffer.alloc(0);
    const socket = connectTo(address);
    const finish = (verdict: 'clean' | 'infected' | 'error') => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(verdict);
    };
    const timer = setTimeout(() => {
      finish('error');
    }, timeoutMs);
    socket.on('error', () => {
      finish('error');
    });
    socket.on('close', () => {
      finish('error');
    });
    socket.on('data', (chunk: Buffer) => {
      answer = Buffer.concat([answer, chunk]);
      const end = answer.indexOf(0);
      if (end >= 0) {
        finish(verdictOfClamdAnswer(answer.subarray(0, end).toString('latin1')));
      } else if (answer.length > CLAMD_MAX_ANSWER_BYTES) {
        finish('error');
      }
    });
    socket.on('connect', () => {
      socket.write(COMMAND);
      for (let offset = 0; offset < bytes.byteLength; offset += CLAMD_CHUNK_BYTES) {
        const chunk = bytes.subarray(
          offset,
          Math.min(bytes.byteLength, offset + CLAMD_CHUNK_BYTES),
        );
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.byteLength);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
