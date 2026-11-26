/**
 * C123.3 (P16): the frames of the code runner. A frame is a 4-byte big-endian length and that many
 * bytes of UTF-8 JSON. Whoever reads one checks the length against the cap before a byte of the
 * payload is buffered, so a header announcing 1 GiB costs four bytes and a kill. A frame is parsed
 * with a depth limit, on the text and without recursion, because a compromised child can send
 * anything. The child reads the same frames by hand (`bin/code-runner-child.mjs`), and so does the
 * container's Unix socket.
 */
import { FRAME_HEADER_BYTES } from './protocol.js';

export type FrameViolationReason = 'frame_too_large' | 'frame_malformed';

/** Carries a code, never a byte of the frame: a frame can hold what a guest wrote (P18). */
export class FrameViolation extends Error {
  constructor(readonly reason: FrameViolationReason) {
    super(reason);
    this.name = 'FrameViolation';
  }
}

export function encodeFrame(value: unknown, maxBytes: number): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length > maxBytes) throw new FrameViolation('frame_too_large');
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

/** Reads one byte stream into frames. After a violation the stream is over: kill its writer. */
export class FrameReader {
  private readonly header = Buffer.alloc(FRAME_HEADER_BYTES);
  private headerFilled = 0;
  private payload: Buffer | null = null;
  private payloadFilled = 0;

  constructor(readonly maxBytes: number) {}

  /** What this reader holds of the frame it is reading. */
  get bufferedBytes(): number {
    return this.payloadFilled;
  }

  push(chunk: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (this.payload === null) {
        const taken = Math.min(FRAME_HEADER_BYTES - this.headerFilled, chunk.length - offset);
        this.header.set(chunk.subarray(offset, offset + taken), this.headerFilled);
        this.headerFilled += taken;
        offset += taken;
        if (this.headerFilled === FRAME_HEADER_BYTES) this.payload = this.allocate();
        continue;
      }
      const taken = Math.min(this.payload.length - this.payloadFilled, chunk.length - offset);
      this.payload.set(chunk.subarray(offset, offset + taken), this.payloadFilled);
      this.payloadFilled += taken;
      offset += taken;
      if (this.payloadFilled === this.payload.length) {
        frames.push(this.payload);
        this.payload = null;
        this.payloadFilled = 0;
        this.headerFilled = 0;
      }
    }
    return frames;
  }

  /** The only allocation, made after the check, of at most the cap. */
  private allocate(): Buffer {
    const length = this.header.readUInt32BE(0);
    if (length > this.maxBytes) throw new FrameViolation('frame_too_large');
    if (length === 0) throw new FrameViolation('frame_malformed');
    return Buffer.allocUnsafe(length);
  }
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACKET = 0x5b;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACKET = 0x5d;
const CLOSE_BRACE = 0x7d;

/** Whether JSON text nests at most `maxDepth` containers, read on the text and never recursively. */
export function jsonDepthWithin(text: string, maxDepth: number): boolean {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (inString) {
      if (code === BACKSLASH) index += 1;
      else if (code === QUOTE) inString = false;
    } else if (code === QUOTE) {
      inString = true;
    } else if (code === OPEN_BRACKET || code === OPEN_BRACE) {
      depth += 1;
      if (depth > maxDepth) return false;
    } else if (code === CLOSE_BRACKET || code === CLOSE_BRACE) {
      depth -= 1;
    }
  }
  return true;
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

export function parseFrame(bytes: Uint8Array, maxDepth: number): unknown {
  let text: string;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    throw new FrameViolation('frame_malformed');
  }
  if (!jsonDepthWithin(text, maxDepth)) throw new FrameViolation('frame_malformed');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FrameViolation('frame_malformed');
  }
}

/** The longest prefix of `text` that fits `maxBytes` of UTF-8, cut at a character boundary. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > maxBytes) break;
    end += character.length;
  }
  return text.slice(0, end);
}
