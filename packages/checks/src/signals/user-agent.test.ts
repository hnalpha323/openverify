import { describe, expect, it } from 'vitest';
import {
  BOWSER_DEVICE_TYPES,
  SDK_USER_AGENT_PATTERN,
  parseSessionDevice,
  sdkDeviceType,
  type ParsedSessionDevice,
} from './user-agent.js';

const NONE: ParsedSessionDevice = {
  osName: null,
  osFullVersion: null,
  browserName: null,
  browserFullVersion: null,
  deviceType: null,
  deviceName: null,
  mobileSdkName: null,
  mobileSdkFullVersion: null,
};

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const FIREFOX_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0';
const WEBOS_TV =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager';
const CRAWLER = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

describe('the session device mapper (C94.5)', () => {
  it("maps bowser's platform types to the session device types", () => {
    expect(BOWSER_DEVICE_TYPES).toEqual({
      desktop: 'desktop',
      mobile: 'smartphone',
      tablet: 'tablet',
      tv: 'tv',
    });
  });

  it.each([
    [
      'Chrome on Windows',
      CHROME_WINDOWS,
      {
        osName: 'Windows',
        osFullVersion: 'NT 10.0',
        browserName: 'Chrome',
        browserFullVersion: '130.0.0.0',
        deviceType: 'desktop',
      },
    ],
    [
      'Safari on an iPhone',
      SAFARI_IPHONE,
      {
        osName: 'iOS',
        osFullVersion: '17.5',
        browserName: 'Safari',
        browserFullVersion: '17.5',
        deviceType: 'smartphone',
        deviceName: 'Apple iPhone',
      },
    ],
    [
      'Safari on an iPad',
      SAFARI_IPAD,
      { osName: 'iOS', deviceType: 'tablet', deviceName: 'Apple iPad', browserName: 'Safari' },
    ],
    [
      'Chrome on Android, no model named',
      CHROME_ANDROID,
      { osName: 'Android', osFullVersion: '14', deviceType: 'smartphone', deviceName: null },
    ],
    [
      'Firefox on a Mac, the vendor alone',
      FIREFOX_MAC,
      {
        osName: 'macOS',
        osFullVersion: '10.15',
        browserName: 'Firefox',
        browserFullVersion: '131.0',
        deviceType: 'desktop',
        deviceName: 'Apple',
      },
    ],
    ['a television', WEBOS_TV, { osName: 'WebOS', deviceType: 'tv' }],
    ['a crawler: no device type', CRAWLER, { deviceType: null, browserName: 'Googlebot' }],
  ])('golden: %s', (_label, userAgent, expected) => {
    const device = parseSessionDevice(userAgent);
    expect(device).toMatchObject({ ...expected, mobileSdkName: null, mobileSdkFullVersion: null });
  });

  it('reads the SDK header exactly, with no library', () => {
    expect(parseSessionDevice('OpenVerify-Android/0.1.0')).toEqual({
      ...NONE,
      osName: 'Android',
      mobileSdkName: 'openverify-android',
      mobileSdkFullVersion: '0.1.0',
    });
    expect(parseSessionDevice('OpenVerify-iOS/1.2.3-rc.1')).toEqual({
      ...NONE,
      osName: 'iOS',
      mobileSdkName: 'openverify-ios',
      mobileSdkFullVersion: '1.2.3-rc.1',
    });
    expect(SDK_USER_AGENT_PATTERN.test('OpenVerify-Android/0.1.0 extra')).toBe(false);
    expect(parseSessionDevice('OpenVerify-Android/0.1.0 extra').mobileSdkName).toBeNull();
    expect(parseSessionDevice('openverify-android/0.1.0').mobileSdkName).toBeNull();
  });

  it('answers every field null without a user agent, never a guess', () => {
    expect(parseSessionDevice(null)).toEqual(NONE);
    expect(parseSessionDevice(undefined)).toEqual(NONE);
    expect(parseSessionDevice('')).toEqual(NONE);
    expect(parseSessionDevice('   ')).toEqual(NONE);
  });

  it('keeps every field within the contract bound of 64 characters', () => {
    const long = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${'1.'.repeat(60)}1 Safari/537.36`;
    const device = parseSessionDevice(long);
    expect(device.browserName).toBe('Chrome');
    for (const value of Object.values(device)) {
      if (typeof value === 'string') {
        expect(value.length).toBeGreaterThan(0);
        expect(value.length).toBeLessThanOrEqual(64);
      }
    }
  });

  it("sets an SDK session's device type from its body's device class only", () => {
    expect(sdkDeviceType('smartphone')).toBe('smartphone');
    expect(sdkDeviceType('tablet')).toBe('tablet');
    expect(sdkDeviceType(null)).toBeNull();
    expect(sdkDeviceType(undefined)).toBeNull();
  });
});
