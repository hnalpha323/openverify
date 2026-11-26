import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  PII_DEVICE_ATTRIBUTES,
  SESSION_DEVICE_ATTRIBUTE_SHAPE,
  buildDeviceResource,
  deviceResourceSchema,
  listDevicesQuerySchema,
  type DeviceRecord,
} from './devices.js';
import { PII_SIGNAL_ATTRIBUTES } from './signal-pii.js';

const AT = new Date('2026-10-30T12:00:00.000Z');
const HEX = (char: string) => char.repeat(64);

const web = (overrides: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id: 'dev_01J00000000000000000000000',
  createdAt: AT,
  deviceFingerprint: null,
  browserFingerprint: HEX('a'),
  deviceClass: HEX('b'),
  platform: 'web',
  collectorVersion: 1,
  fingerprintRandomised: false,
  keyId: 'AbCdEfGh_-1',
  sessionCount: 2,
  firstSeenAt: AT,
  lastSeenAt: AT,
  ...overrides,
});

describe('the device resource (C91.2, C94.4)', () => {
  it('builds a web device: the strict fingerprint and our device class, no vendor id', () => {
    const resource = buildDeviceResource(web());
    expect(resource).toMatchObject({
      type: 'device',
      attributes: {
        'device-vendor-id': null,
        'device-fingerprint': null,
        'browser-fingerprint': HEX('a'),
        'device-class': HEX('b'),
        'key-id': 'AbCdEfGh_-1',
      },
    });
    expect(deviceResourceSchema.parse(resource)).toEqual(resource);
  });

  it('builds an Android device from its ANDROID_ID HMAC alone (V10)', () => {
    expect(
      buildDeviceResource(
        web({
          platform: 'android',
          deviceFingerprint: HEX('c'),
          browserFingerprint: null,
          deviceClass: null,
        }),
      ).attributes['device-fingerprint'],
    ).toBe(HEX('c'));
  });

  it('never serves the web device class as the device fingerprint, or an Android one on web', () => {
    expect(() => buildDeviceResource(web({ deviceFingerprint: HEX('c') }))).toThrow(z.ZodError);
    expect(() =>
      buildDeviceResource(web({ platform: 'android', deviceFingerprint: HEX('c') })),
    ).toThrow(z.ZodError);
  });

  it('drops the strict fingerprint when the canvas was randomised, keeping the class (C94.4)', () => {
    expect(() => buildDeviceResource(web({ fingerprintRandomised: true }))).toThrow(z.ZodError);
    expect(
      buildDeviceResource(web({ fingerprintRandomised: true, browserFingerprint: null }))
        .attributes['device-class'],
    ).toBe(HEX('b'));
  });

  it('takes 64 lowercase hex fingerprints and an 11-character key id only', () => {
    expect(() => buildDeviceResource(web({ browserFingerprint: 'ABC' }))).toThrow(z.ZodError);
    expect(() => buildDeviceResource(web({ keyId: 'short' }))).toThrow(z.ZodError);
  });

  it('marks both fingerprints PII, and they join PII_SIGNAL_ATTRIBUTES (C91.6)', () => {
    expect(PII_DEVICE_ATTRIBUTES).toEqual(['device-fingerprint', 'browser-fingerprint']);
    expect(PII_SIGNAL_ATTRIBUTES).toEqual(
      expect.arrayContaining(['device-fingerprint', 'browser-fingerprint']),
    );
    expect(PII_SIGNAL_ATTRIBUTES).not.toContain('device-class');
  });

  it('lists devices of one session', () => {
    expect(
      listDevicesQuerySchema.parse({
        'filter[inquiry-session-id]': 'iqse_01J00000000000000000000000',
      }),
    ).toMatchObject({ 'filter[inquiry-session-id]': 'iqse_01J00000000000000000000000' });
  });
});

describe('the session device fields (C91.1, C94.5)', () => {
  const session = z.strictObject(SESSION_DEVICE_ATTRIBUTE_SHAPE);
  const fields = {
    'os-name': 'Android',
    'os-full-version': '14',
    'browser-name': null,
    'browser-full-version': null,
    'device-type': 'smartphone',
    'device-name': null,
    'mobile-sdk-name': 'openverify-android',
    'mobile-sdk-full-version': '0.1.0',
    'signals-collected': ['session-integrity'],
  };

  it('holds the public names and our signals-collected', () => {
    expect(session.safeParse(fields).success).toBe(true);
    expect(session.safeParse({ ...fields, 'device-type': 'phone' }).success).toBe(false);
    expect(session.safeParse({ ...fields, 'mobile-sdk-name': 'other-sdk' }).success).toBe(false);
    expect(
      session.safeParse({
        ...fields,
        'signals-collected': ['session-integrity', 'session-integrity'],
      }).success,
    ).toBe(false);
    expect(session.safeParse({ ...fields, 'os-name': 'x'.repeat(65) }).success).toBe(false);
  });
});
