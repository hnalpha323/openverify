import { describe, expect, it } from 'vitest';
import { SHORT_WINDOW_SECONDS, checkSettingsWindows } from './graph.js';

describe('checkSettingsWindows (C147.6, C171.4: WCAG 2.2.1)', () => {
  it('warns, never blocks, for each window below 20 hours, by pointer into the settings', () => {
    expect(SHORT_WINDOW_SECONDS).toBe(72_000);
    expect(
      checkSettingsWindows({
        'inquiry-expiration-seconds': 3600,
        'session-expiration-seconds': 72_000,
        'inquiry-expiration-after-start-seconds': null,
        'inquiry-expiration-after-resume-seconds': 71_999,
        'one-time-link-expiration-seconds': 60,
      }),
    ).toEqual([
      {
        pointer: '/inquiry-expiration-seconds',
        code: 'window_below_20_hours',
        detail:
          'A person may need more time than this window gives (WCAG 2.2.1); 20 hours is the threshold',
        severity: 'warning',
      },
      {
        pointer: '/inquiry-expiration-after-resume-seconds',
        code: 'window_below_20_hours',
        detail:
          'A person may need more time than this window gives (WCAG 2.2.1); 20 hours is the threshold',
        severity: 'warning',
      },
    ]);
    expect(checkSettingsWindows({})).toEqual([]);
  });
});
