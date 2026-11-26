import { describe, expect, it } from 'vitest';
import {
  DEVICE_HANDOFF_DEFAULTS,
  DEVICE_HANDOFF_METHODS,
  STEP_TYPES,
  deviceHandoffStepSchema,
} from './flow.js';

const ok = (step: unknown) => deviceHandoffStepSchema.safeParse(step).success;

describe('the device_handoff step (C96.1)', () => {
  it('is a step type, snake case like the other fifteen', () => {
    expect(STEP_TYPES).toContain('device_handoff');
    expect(STEP_TYPES).toHaveLength(16);
  });

  it('takes its config, every member optional with the plan defaults', () => {
    expect(ok({ id: 'handoff', type: 'device_handoff' })).toBe(true);
    expect(DEVICE_HANDOFF_METHODS).toEqual(['qr', 'email', 'sms']);
    expect(DEVICE_HANDOFF_DEFAULTS).toEqual({
      methods: ['qr'],
      qrTtlSeconds: 300,
      linkTtlSeconds: 900,
      confirmationCode: false,
      skipOnMobile: true,
      allowContinueHere: true,
    });
    expect(
      ok({
        id: 'handoff',
        type: 'device_handoff',
        methods: ['qr', 'email', 'sms'],
        qrTtlSeconds: 120,
        linkTtlSeconds: 3600,
        confirmationCode: true,
        skipOnMobile: false,
        allowContinueHere: false,
      }),
    ).toBe(true);
  });

  it('bounds the lifetimes: QR 2 to 15 minutes, links 5 to 60 (ours, H27)', () => {
    expect(ok({ id: 'h', type: 'device_handoff', qrTtlSeconds: 119 })).toBe(false);
    expect(ok({ id: 'h', type: 'device_handoff', qrTtlSeconds: 901 })).toBe(false);
    expect(ok({ id: 'h', type: 'device_handoff', linkTtlSeconds: 299 })).toBe(false);
    expect(ok({ id: 'h', type: 'device_handoff', linkTtlSeconds: 3601 })).toBe(false);
  });

  it('refuses an empty or repeated method list, an unknown method and unknown members', () => {
    expect(ok({ id: 'h', type: 'device_handoff', methods: [] })).toBe(false);
    expect(ok({ id: 'h', type: 'device_handoff', methods: ['qr', 'qr'] })).toBe(false);
    expect(ok({ id: 'h', type: 'device_handoff', methods: ['whatsapp'] })).toBe(false);
    expect(ok({ id: 'h', type: 'device_handoff', redirectUrl: 'https://example.org' })).toBe(false);
  });
});
