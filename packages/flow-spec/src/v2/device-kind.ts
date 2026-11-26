/**
 * C150.2 (owner `flow-spec-logic`; reviews H27, F15): `device.kind` from Phase 7 C91's parsed
 * `device-type` and `mobile-sdk-name` (`inquiry_sessions.device_type`, `mobile_sdk_name`), never
 * Phase 7's pseudonymous device class. A session an SDK opened is `native` whatever its form
 * factor; a phone or a tablet browser is `mobile-web`; a desktop browser `desktop-web`; a TV, an
 * unknown value or no value is `null`, so a route reading it declares `onNull` (C150.3).
 */
import type { DeviceKind } from './schemas/steps.js';

const WEB_KINDS: Readonly<Record<string, DeviceKind>> = Object.freeze({
  desktop: 'desktop-web',
  smartphone: 'mobile-web',
  tablet: 'mobile-web',
});

export function deviceKindOf(input: {
  readonly deviceType: string | null;
  readonly mobileSdkName: string | null;
}): DeviceKind | null {
  if (input.mobileSdkName !== null && input.mobileSdkName !== '') {
    return 'native';
  }
  const { deviceType } = input;
  return deviceType !== null && Object.hasOwn(WEB_KINDS, deviceType)
    ? (WEB_KINDS[deviceType] ?? null)
    : null;
}
