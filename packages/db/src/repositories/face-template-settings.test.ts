import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACE_TEMPLATE_SETTINGS,
  DEFAULT_OTP_SMS_MAX_PER_HOUR,
  resolveFaceTemplateSettings,
  resolveOtpSmsMaxPerHour,
} from './retention.js';

describe('the face template settings (C42.4, C42.6)', () => {
  it('default to 365 days and 50,000 templates', () => {
    expect(DEFAULT_FACE_TEMPLATE_SETTINGS).toEqual({
      'face-template-retention-days': 365,
      'face-search-max-templates': 50_000,
    });
    expect(resolveFaceTemplateSettings({})).toEqual(DEFAULT_FACE_TEMPLATE_SETTINGS);
  });

  it('take the values an environment stores', () => {
    expect(
      resolveFaceTemplateSettings({
        'event-retention-days': 7,
        'face-template-retention-days': 30,
        'face-search-max-templates': 1000,
      }),
    ).toEqual({ 'face-template-retention-days': 30, 'face-search-max-templates': 1000 });
  });
});

describe('resolveOtpSmsMaxPerHour (C55.7)', () => {
  it('reads the stored budget, else 200', () => {
    expect(resolveOtpSmsMaxPerHour({})).toBe(DEFAULT_OTP_SMS_MAX_PER_HOUR);
    expect(DEFAULT_OTP_SMS_MAX_PER_HOUR).toBe(200);
    expect(resolveOtpSmsMaxPerHour({ 'otp-sms-max-per-hour': 40 })).toBe(40);
  });
});
