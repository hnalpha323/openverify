/**
 * C62.1 (P19): the bounded BER-TLV reader. {@link prescanTlv} walks one TLV and every TLV nested
 * in it, within the depth and node caps of `EMRTD_LIMITS`, before asn1js or any parser sees a
 * chip file; {@link readTlv} and {@link tlvChildren} read the data groups' application-class
 * templates (`61`, `75`, `7F61`, `5F1F`, ...) with their original byte ranges.
 *
 * Definite lengths (short and long form, BER's non-minimal forms included) and, inside a
 * constructed TLV, the indefinite form closed by end-of-contents are read; tags are one to four
 * bytes. Anything else throws `EmrtdError('chip_data_malformed')`; a cap throws
 * `EmrtdError('limit_exceeded')`. Messages name the step, never a byte.
 */
import { EmrtdError } from './errors.js';
import { EMRTD_LIMITS } from './limits.js';

/** One TLV and where it lies in its buffer (offsets into the buffer it was read from). */
export interface TlvNode {
  /** The tag bytes as one number: `0x30`, `0x5f1f`, `0x7f61`. */
  readonly tag: number;
  readonly constructed: boolean;
  /** The first tag byte. */
  readonly start: number;
  readonly valueStart: number;
  /** Exclusive; before the end-of-contents of an indefinite length. */
  readonly valueEnd: number;
  /** Exclusive: the byte after this TLV. */
  readonly end: number;
}

/** The caps of one walk: depth (the outermost TLV is depth 1) and nodes. */
export interface TlvLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
}

/** What {@link prescanTlv} found: the deepest nesting, the TLVs counted, the outer TLV's end. */
export interface TlvScan {
  readonly depth: number;
  readonly nodes: number;
  /** The byte after the outer TLV; bytes after it are not part of it. */
  readonly end: number;
}

const CHIP_LIMITS: TlvLimits = {
  maxDepth: EMRTD_LIMITS.tlvMaxDepth,
  maxNodes: EMRTD_LIMITS.tlvMaxNodes,
};

/** At most four tag bytes and four length bytes: no chip file comes near either. */
const MAX_TAG_BYTES = 4;
const MAX_LENGTH_BYTES = 4;

interface Walk {
  readonly bytes: Uint8Array;
  readonly limits: TlvLimits;
  readonly step: string;
  nodes: number;
  deepest: number;
}

interface Header {
  readonly tag: number;
  readonly constructed: boolean;
  readonly valueStart: number;
  /** `null` for the indefinite form. */
  readonly length: number | null;
}

function malformed(step: string): never {
  throw new EmrtdError('chip_data_malformed', step);
}

function byteAt(walk: Walk, offset: number, limit: number): number {
  const value = offset < limit ? walk.bytes[offset] : undefined;
  return value ?? malformed(walk.step);
}

function readHeader(walk: Walk, offset: number, limit: number): Header {
  const first = byteAt(walk, offset, limit);
  let position = offset + 1;
  let tag = first;
  if ((first & 0x1f) === 0x1f) {
    for (let count = 1; ; count += 1) {
      if (count >= MAX_TAG_BYTES) {
        malformed(walk.step);
      }
      const next = byteAt(walk, position, limit);
      position += 1;
      tag = tag * 256 + next;
      if ((next & 0x80) === 0) {
        break;
      }
    }
  }
  const constructed = (first & 0x20) !== 0;
  const lengthByte = byteAt(walk, position, limit);
  position += 1;
  if (lengthByte < 0x80) {
    return { tag, constructed, valueStart: position, length: lengthByte };
  }
  if (lengthByte === 0x80) {
    return constructed
      ? { tag, constructed, valueStart: position, length: null }
      : malformed(walk.step);
  }
  const count = lengthByte & 0x7f;
  if (count > MAX_LENGTH_BYTES) {
    malformed(walk.step);
  }
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    length = length * 256 + byteAt(walk, position, limit);
    position += 1;
  }
  return { tag, constructed, valueStart: position, length };
}

/** Whether an end-of-contents (`00 00`) starts at `offset`. */
function endOfContentsAt(walk: Walk, offset: number, limit: number): boolean {
  return offset + 1 < limit && walk.bytes[offset] === 0 && walk.bytes[offset + 1] === 0;
}

/**
 * Reads the TLV at `offset` within `limit`. With `descend`, every nested TLV is read and counted
 * against the caps; without, only an indefinite length's children are walked, to find its end.
 */
function readNode(
  walk: Walk,
  offset: number,
  limit: number,
  depth: number,
  descend: boolean,
): TlvNode {
  walk.nodes += 1;
  walk.deepest = Math.max(walk.deepest, depth);
  if (walk.nodes > walk.limits.maxNodes || depth > walk.limits.maxDepth) {
    throw new EmrtdError('limit_exceeded', walk.step);
  }
  const header = readHeader(walk, offset, limit);
  if (header.tag === 0) {
    malformed(walk.step);
  }
  const { tag, constructed, valueStart, length } = header;
  if (length !== null) {
    const valueEnd = valueStart + length;
    if (valueEnd > limit) {
      malformed(walk.step);
    }
    if (constructed && descend) {
      let position = valueStart;
      while (position < valueEnd) {
        position = readNode(walk, position, valueEnd, depth + 1, true).end;
      }
    }
    return { tag, constructed, start: offset, valueStart, valueEnd, end: valueEnd };
  }
  let position = valueStart;
  while (!endOfContentsAt(walk, position, limit)) {
    position = readNode(walk, position, limit, depth + 1, descend).end;
  }
  return { tag, constructed, start: offset, valueStart, valueEnd: position, end: position + 2 };
}

/**
 * The bounded pre-scan: one well-formed BER-TLV at the start of `bytes`, within the caps
 * (`EMRTD_LIMITS` unless given). Bytes after the TLV are left to the caller (`end`).
 */
export function prescanTlv(bytes: Uint8Array, limits: TlvLimits = CHIP_LIMITS): TlvScan {
  const walk: Walk = { bytes, limits, step: 'prescanTlv', nodes: 0, deepest: 0 };
  const node = readNode(walk, 0, bytes.length, 1, true);
  return { depth: walk.deepest, nodes: walk.nodes, end: node.end };
}

/** The TLV at `offset`, which must end at or before `limit` (the buffer's end by default). */
export function readTlv(bytes: Uint8Array, offset = 0, limit = bytes.length): TlvNode {
  const walk: Walk = { bytes, limits: CHIP_LIMITS, step: 'readTlv', nodes: 0, deepest: 0 };
  return readNode(walk, offset, Math.min(limit, bytes.length), 1, false);
}

/** The TLVs a constructed TLV holds, in order. */
export function tlvChildren(bytes: Uint8Array, node: TlvNode): TlvNode[] {
  if (!node.constructed) {
    malformed('tlvChildren');
  }
  const children: TlvNode[] = [];
  let position = node.valueStart;
  while (position < node.valueEnd) {
    const child = readTlv(bytes, position, node.valueEnd);
    children.push(child);
    position = child.end;
  }
  return children;
}

/** The value bytes of a TLV (a view into `bytes`). */
export function tlvValue(bytes: Uint8Array, node: TlvNode): Uint8Array {
  return bytes.subarray(node.valueStart, node.valueEnd);
}

/** The whole TLV, tag and length included (a view into `bytes`). */
export function tlvBytes(bytes: Uint8Array, node: TlvNode): Uint8Array {
  return bytes.subarray(node.start, node.end);
}

/** The first child with `tag`, or `null`. */
export function findChild(bytes: Uint8Array, node: TlvNode, tag: number): TlvNode | null {
  return tlvChildren(bytes, node).find((child) => child.tag === tag) ?? null;
}
