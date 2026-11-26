/**
 * C178.4 (Workflow 9B, integration-9b): what the 9B full-stack specs share. The server API called
 * with a token (an API key or an `ovu_` session), a poll, and a small PNG made by code (rule 9:
 * no downloaded image). Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { StackInfo } from '../../src/stack-info.js';
import { dashboardRequest, signInToApi, type JsonAnswer } from './platform.js';
import { createOperator, sessionTokenAs } from './ui.js';

/** One server API request (`/api/v1<path>`) with `token`, its JSON answer. */
export async function serverRequest(
  stack: StackInfo,
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<JsonAnswer> {
  const response = await fetch(`${stack.apiUrl}/api/v1${path}`, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(body === undefined || body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    // A CSV download is answered as text.
  }
  return { status: response.status, headers: response.headers, body: parsed };
}

/** `answer` when its status is `status`, else an error naming what answered. */
export function expectStatus(answer: JsonAnswer, status: number, what: string): JsonAnswer {
  if (answer.status !== status) {
    throw new Error(`${what} answered ${String(answer.status)}: ${JSON.stringify(answer.body)}`);
  }
  return answer;
}

/** Polls `read` every 500 ms until `done` holds, at most `timeoutMs`. */
export async function pollUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value)) {
    if (Date.now() > deadline) {
      throw new Error(`${what}: not reached within ${String(timeoutMs)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    value = await read();
  }
  return value;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A decodable RGB PNG of `width` by `height` in one colour, made here (rule 9). */
export function syntheticPng(
  width: number,
  height: number,
  rgb = [37, 99, 235],
): Uint8Array<ArrayBuffer> {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row.set(rgb, 1 + x * 3);
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
  return png;
}

/** Today's date in UTC, the analytics default zone (`YYYY-MM-DD`). */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/**
 * A new operator holding one custom role of `permissions` through one assignment reaching
 * `environmentIds` (`null`: organisation-wide), and its `ovu_` session token (C167.2, C167.3).
 * The operator is invited as a viewer (C15), then the admin replaces the assignment.
 */
export async function operatorWithRole(
  stack: StackInfo,
  permissions: readonly string[],
  environmentIds: readonly string[] | null,
): Promise<{ email: string; userId: string; signIn: () => Promise<string> }> {
  const operator = await createOperator(stack, 'viewer');
  const adminToken = await sessionTokenAs(stack, 'admin');
  const role = expectStatus(
    await dashboardRequest(stack, 'POST', '/roles', {
      token: adminToken,
      body: {
        data: {
          type: 'role',
          attributes: { name: `e2e role ${randomUUID().slice(0, 8)}`, permissions },
        },
      },
    }),
    201,
    'the role',
  ).body as { data: { id: string } };
  const users = expectStatus(
    await dashboardRequest(stack, 'GET', '/users?page[size]=100', { token: adminToken }),
    200,
    'the users list',
  ).body as { data: { id: string; attributes: { email: string } }[] };
  const userId = users.data.find((user) => user.attributes.email === operator.email)?.id;
  if (userId === undefined) {
    throw new Error(`The invited operator ${operator.email} is not listed`);
  }
  expectStatus(
    await dashboardRequest(stack, 'PUT', `/users/${userId}/roles`, {
      token: adminToken,
      body: { assignments: [{ 'role-id': role.data.id, 'environment-ids': environmentIds }] },
    }),
    200,
    'the role assignment',
  );
  return {
    email: operator.email,
    userId,
    signIn: () => signInToApi(stack, { email: operator.email, password: operator.password }),
  };
}

/** RFC 4180 rows of `text`: quoted cells, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
