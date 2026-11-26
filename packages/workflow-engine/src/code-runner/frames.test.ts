/**
 * C123.3 (P16): a frame is a 4-byte big-endian length and that many bytes of UTF-8 JSON. The length
 * is checked against the cap before a byte of the payload is buffered, and a frame is parsed with a
 * depth limit, because a compromised child can send anything. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import {
  FrameReader,
  FrameViolation,
  encodeFrame,
  jsonDepthWithin,
  parseFrame,
  truncateUtf8,
} from './frames.js';
import { FRAME_HEADER_BYTES } from './protocol.js';

const CAP = 1024;

const header = (length: number): Buffer => {
  const bytes = Buffer.alloc(FRAME_HEADER_BYTES);
  bytes.writeUInt32BE(length);
  return bytes;
};

const violationOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FrameViolation);
    return (error as FrameViolation).reason;
  }
  throw new Error('no violation');
};

describe('encodeFrame', () => {
  it('writes a big-endian length, then the JSON in UTF-8', () => {
    const frame = encodeFrame({ text: 'é' }, CAP);
    const payload = JSON.stringify({ text: 'é' });
    expect(frame.readUInt32BE(0)).toBe(Buffer.byteLength(payload));
    expect(frame.subarray(FRAME_HEADER_BYTES).toString('utf8')).toBe(payload);
  });

  it('refuses a frame past its cap, at the writer too', () => {
    expect(violationOf(() => encodeFrame({ text: 'x'.repeat(CAP) }, CAP))).toBe('frame_too_large');
  });
});

describe('FrameReader', () => {
  it('reads a frame that arrives whole', () => {
    const reader = new FrameReader(CAP);
    const frames = reader.push(encodeFrame({ id: 1 }, CAP));
    expect(frames.map((frame) => parseFrame(frame, 4))).toEqual([{ id: 1 }]);
    expect(reader.bufferedBytes).toBe(0);
  });

  it('reads frames split at every byte, and several in one chunk', () => {
    const stream = Buffer.concat([encodeFrame({ id: 1 }, CAP), encodeFrame({ id: 2 }, CAP)]);
    const split = new FrameReader(CAP);
    const seen: unknown[] = [];
    for (const byte of stream) {
      for (const frame of split.push(Uint8Array.of(byte))) seen.push(parseFrame(frame, 4));
    }
    expect(seen).toEqual([{ id: 1 }, { id: 2 }]);
    expect(new FrameReader(CAP).push(stream)).toHaveLength(2);
  });

  it('refuses an announced length past the cap before buffering a byte of the payload', () => {
    const reader = new FrameReader(CAP);
    const announced = Buffer.concat([header(1024 * 1024 * 1024), Buffer.alloc(16, 0x78)]);
    expect(violationOf(() => reader.push(announced))).toBe('frame_too_large');
    expect(reader.bufferedBytes).toBe(0);
  });

  it('refuses the announcement alone, with no payload byte sent', () => {
    expect(violationOf(() => new FrameReader(CAP).push(header(CAP + 1)))).toBe('frame_too_large');
  });

  it('takes a frame of exactly the cap', () => {
    const payload = Buffer.alloc(CAP, 0x20);
    const frames = new FrameReader(CAP).push(Buffer.concat([header(CAP), payload]));
    expect(frames[0]).toHaveLength(CAP);
  });

  it('refuses an empty frame', () => {
    expect(violationOf(() => new FrameReader(CAP).push(header(0)))).toBe('frame_malformed');
  });

  it('does not hold a frame that has been handed out', () => {
    const reader = new FrameReader(CAP);
    const frame = encodeFrame({ id: 1 }, CAP);
    reader.push(frame.subarray(0, frame.length - 1));
    expect(reader.bufferedBytes).toBe(frame.length - FRAME_HEADER_BYTES - 1);
    reader.push(frame.subarray(frame.length - 1));
    expect(reader.bufferedBytes).toBe(0);
  });
});

describe('jsonDepthWithin', () => {
  const nested = (depth: number): string => '['.repeat(depth) + ']'.repeat(depth);

  it('counts containers, a scalar being depth 0', () => {
    expect(jsonDepthWithin('1', 0)).toBe(true);
    expect(jsonDepthWithin('[]', 0)).toBe(false);
    expect(jsonDepthWithin('{"a":[{}]}', 3)).toBe(true);
    expect(jsonDepthWithin('{"a":[{}]}', 2)).toBe(false);
    expect(jsonDepthWithin(nested(32), 32)).toBe(true);
    expect(jsonDepthWithin(nested(33), 32)).toBe(false);
  });

  it('reads brackets inside strings as text, escaped quotes included', () => {
    expect(jsonDepthWithin('"[[[["', 0)).toBe(true);
    expect(jsonDepthWithin(String.raw`["\"[[[["]`, 1)).toBe(true);
    expect(jsonDepthWithin(String.raw`["\\",[[]]]`, 2)).toBe(false);
  });

  it('answers without recursion, however deep the text', () => {
    expect(jsonDepthWithin('['.repeat(5_000_000), 32)).toBe(false);
  });
});

describe('parseFrame', () => {
  const bytes = (text: string): Uint8Array => Buffer.from(text, 'utf8');

  it('parses JSON within the depth', () => {
    expect(parseFrame(bytes('{"kind":"value","value":[1]}'), 2)).toEqual({
      kind: 'value',
      value: [1],
    });
  });

  it('refuses JSON past the depth, before parsing it', () => {
    expect(violationOf(() => parseFrame(bytes('[[[]]]'), 2))).toBe('frame_malformed');
  });

  it('refuses text that is not JSON, and bytes that are not UTF-8', () => {
    expect(violationOf(() => parseFrame(bytes('{"kind":'), 4))).toBe('frame_malformed');
    expect(violationOf(() => parseFrame(Uint8Array.of(0x22, 0xff, 0x22), 4))).toBe(
      'frame_malformed',
    );
  });

  it('keeps a __proto__ key as a plain own property', () => {
    const parsed = parseFrame(bytes('{"__proto__":{"polluted":true}}'), 4) as object;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('truncateUtf8', () => {
  it('keeps text within the cap unchanged', () => {
    expect(truncateUtf8('plain', 5)).toBe('plain');
  });

  it('cuts at a character boundary, in bytes', () => {
    expect(truncateUtf8('ééé', 5)).toBe('éé');
    expect(truncateUtf8('a😀b', 4)).toBe('a');
    expect(Buffer.byteLength(truncateUtf8('😀'.repeat(1024), 1024))).toBeLessThanOrEqual(1024);
  });
});
