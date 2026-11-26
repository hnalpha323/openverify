import { describe, expect, it } from 'vitest';
import { deviceKindOf } from './device-kind.js';

/**
 * C150.2's golden vectors: `mobile-sdk-name` set -> `native`; `smartphone` or `tablet` ->
 * `mobile-web`; `desktop` -> `desktop-web`; `tv` or null -> null (reviews H27, F15). The inputs are
 * Phase 7 C91's parsed `inquiry_sessions.device_type` and `mobile_sdk_name`.
 */
const VECTORS: readonly [string | null, string | null, string | null][] = [
  ['desktop', null, 'desktop-web'],
  ['smartphone', null, 'mobile-web'],
  ['tablet', null, 'mobile-web'],
  ['tv', null, null],
  [null, null, null],
  ['smartphone', 'openverify-android', 'native'],
  ['tablet', 'openverify-android', 'native'],
  [null, 'openverify-android', 'native'],
  ['desktop', 'openverify-ios', 'native'],
  ['tv', 'openverify-android', 'native'],
  // Anything outside Phase 7's vocabularies is unknown, never guessed.
  ['console', null, null],
  ['', null, null],
  ['desktop', '', 'desktop-web'],
];

describe('deviceKindOf (C150.2)', () => {
  it.each(VECTORS)('device type %j with SDK %j is %j', (deviceType, mobileSdkName, kind) => {
    expect(deviceKindOf({ deviceType, mobileSdkName })).toBe(kind);
  });
});
