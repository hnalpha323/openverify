/**
 * C159.4: the client's guard of the flow's messages is hand-written (no zod, for the 6 KB budget),
 * so this test holds it to the frozen `flowToParentMessageSchema` of `@openverify/contracts` over
 * generated vectors, and checks that nothing of the guard reads a value it does not need.
 */
import { flowToParentMessageSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { EMBED_PROTOCOL_VERSION, readFlowMessage } from './messages';

const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const base = { source: 'openverify-flow', version: 1 } as const;

const valid: readonly unknown[] = [
  { ...base, type: 'ready' },
  { ...base, type: 'event', name: 'start' },
  { ...base, type: 'event', name: 'step-changed', metadata: { 'step-type': 'government_id' } },
  { ...base, type: 'event', name: 'complete', metadata: {} },
  { ...base, type: 'event', name: 'cancel' },
  { ...base, type: 'event', name: 'error' },
  { ...base, type: 'resize', height: 0 },
  { ...base, type: 'resize', height: 640 },
  { ...base, type: 'resize', height: 100_000 },
  { ...base, type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'completed' },
  { ...base, type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'needs_review' },
  { ...base, type: 'cancel', 'inquiry-id': INQUIRY_ID },
  { ...base, type: 'error', code: 'camera_error' },
  { ...base, type: 'error', code: 'unknown' },
];

const invalid: readonly unknown[] = [
  null,
  undefined,
  'ready',
  42,
  [],
  { type: 'ready' },
  { ...base, source: 'openverify-preview', type: 'ready' },
  { ...base, version: 2, type: 'ready' },
  { ...base, version: '1', type: 'ready' },
  { ...base, type: 'hello' },
  { ...base, type: 'ready', extra: true },
  { ...base, type: 'event', name: 'navigated' },
  { ...base, type: 'event', name: 'step-changed', metadata: { 'step-id': 'consent' } },
  { ...base, type: 'event', name: 'step-changed', metadata: { 'step-type': 'x'.repeat(41) } },
  { ...base, type: 'event', name: 'step-changed', metadata: { 'step-type': 7 } },
  { ...base, type: 'event', name: 'start', metadata: null },
  { ...base, type: 'event', name: 'start', value: 'x' },
  { ...base, type: 'resize', height: -1 },
  { ...base, type: 'resize', height: 100_001 },
  { ...base, type: 'resize', height: 1.5 },
  { ...base, type: 'resize', height: '640' },
  { ...base, type: 'resize' },
  { ...base, type: 'complete', 'inquiry-id': 'inq_bad', status: 'completed' },
  { ...base, type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'passed' },
  { ...base, type: 'complete', 'inquiry-id': INQUIRY_ID },
  { ...base, type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'completed', fields: {} },
  { ...base, type: 'cancel', 'inquiry-id': `${INQUIRY_ID}x` },
  { ...base, type: 'cancel' },
  { ...base, type: 'error', code: 'not_a_code' },
  { ...base, type: 'error', code: 'unknown', message: 'x' },
];

describe('readFlowMessage (C159.4)', () => {
  it('speaks version 1 of the embed protocol', () => {
    expect(EMBED_PROTOCOL_VERSION).toBe(1);
  });

  it('accepts exactly what the frozen schema accepts', () => {
    for (const message of [...valid, ...invalid]) {
      const schema = flowToParentMessageSchema.safeParse(message).success;
      expect(readFlowMessage(message) !== null, JSON.stringify(message)).toBe(schema);
    }
    expect(valid.every((message) => flowToParentMessageSchema.safeParse(message).success)).toBe(
      true,
    );
    expect(invalid.some((message) => flowToParentMessageSchema.safeParse(message).success)).toBe(
      false,
    );
  });

  it('answers the members it read', () => {
    expect(
      readFlowMessage({ ...base, type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'failed' }),
    ).toEqual({ type: 'complete', 'inquiry-id': INQUIRY_ID, status: 'failed' });
    expect(readFlowMessage({ ...base, type: 'resize', height: 480 })).toEqual({
      type: 'resize',
      height: 480,
    });
  });
});
