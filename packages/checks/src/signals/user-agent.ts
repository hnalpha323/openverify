/**
 * C94.5: the session's parsed device fields (C91.1) from its `User-Agent`.
 *
 * - **The SDKs** name themselves exactly, `OpenVerify-Android/<version>` or
 *   `OpenVerify-iOS/<version>`, parsed with no library into `mobile-sdk-name` and
 *   `mobile-sdk-full-version`; the SDK's name also gives `os-name`. An SDK session's `device-type`
 *   comes from the SDK's `device-class` in its first signal body ({@link sdkDeviceType}), and is
 *   `null` until one arrives.
 * - **Browsers** are parsed with bowser 2.14.1 (MIT). `device-type` maps bowser's platform types:
 *   `desktop`, `mobile` to `smartphone`, `tablet`, `tv`; anything else (bowser's `bot`, or no
 *   type) is `null`. `device-name` is the vendor and model where the user agent names them.
 *
 * Every field is `null` when the user agent does not say, never a guess. Strings are trimmed and
 * cut to the contract's 64 characters. The parsed fields are not PII; the user agent itself is,
 * and is never logged here.
 */
import Bowser from 'bowser';
import type { AndroidDeviceClass, SessionDeviceType } from './inputs.js';

/** The parsed device fields of a session, as the API records them (C91.1). */
export interface ParsedSessionDevice {
  readonly osName: string | null;
  readonly osFullVersion: string | null;
  readonly browserName: string | null;
  readonly browserFullVersion: string | null;
  readonly deviceType: SessionDeviceType | null;
  readonly deviceName: string | null;
  readonly mobileSdkName: 'openverify-android' | 'openverify-ios' | null;
  readonly mobileSdkFullVersion: string | null;
}

/** C94.5: the SDK header, matched whole. */
export const SDK_USER_AGENT_PATTERN =
  /^OpenVerify-(Android|iOS)\/([0-9A-Za-z][0-9A-Za-z.+-]{0,63})$/;

/** C94.5: bowser's platform types and the session's `device-type`. */
export const BOWSER_DEVICE_TYPES: Readonly<Record<string, SessionDeviceType>> = Object.freeze({
  desktop: 'desktop',
  mobile: 'smartphone',
  tablet: 'tablet',
  tv: 'tv',
});

/** The contract's bound on every parsed string (C91.1). */
const MAX_LENGTH = 64;

const NOTHING: ParsedSessionDevice = Object.freeze({
  osName: null,
  osFullVersion: null,
  browserName: null,
  browserFullVersion: null,
  deviceType: null,
  deviceName: null,
  mobileSdkName: null,
  mobileSdkFullVersion: null,
});

/** A trimmed string of 1 to 64 characters, or `null`. */
function text(value: string | undefined): string | null {
  const trimmed = value?.trim().slice(0, MAX_LENGTH).trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function deviceTypeOf(platformType: string | undefined): SessionDeviceType | null {
  return platformType !== undefined && Object.hasOwn(BOWSER_DEVICE_TYPES, platformType)
    ? (BOWSER_DEVICE_TYPES[platformType] ?? null)
    : null;
}

/** The parsed device fields of `userAgent`; every field `null` without one. */
export function parseSessionDevice(userAgent: string | null | undefined): ParsedSessionDevice {
  const raw = userAgent?.trim() ?? '';
  if (raw === '') {
    return NOTHING;
  }
  const sdk = SDK_USER_AGENT_PATTERN.exec(raw);
  if (sdk !== null) {
    const android = sdk[1] === 'Android';
    return {
      ...NOTHING,
      osName: android ? 'Android' : 'iOS',
      mobileSdkName: android ? 'openverify-android' : 'openverify-ios',
      mobileSdkFullVersion: text(sdk[2]),
    };
  }
  const { browser, os, platform } = Bowser.parse(raw);
  return {
    ...NOTHING,
    osName: text(os.name),
    osFullVersion: text(os.version),
    browserName: text(browser.name),
    browserFullVersion: text(browser.version),
    deviceType: deviceTypeOf(platform.type),
    deviceName: text([platform.vendor, platform.model].filter(Boolean).join(' ')),
  };
}

/** C94.5: an SDK session's `device-type`, from the `device-class` of its first signal body. */
export function sdkDeviceType(
  deviceClass: AndroidDeviceClass | null | undefined,
): SessionDeviceType | null {
  return deviceClass ?? null;
}
