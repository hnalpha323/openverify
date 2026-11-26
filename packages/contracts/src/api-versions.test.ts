import { describe, expect, it } from 'vitest';
import {
  API_VERSIONS,
  API_VERSION_HEADER,
  LATEST_API_VERSION,
  apiVersionSchema,
  isApiVersion,
  latestApiVersion,
} from './api-versions.js';

describe('API versions (C12)', () => {
  it('start at 2026-10-01', () => {
    expect(API_VERSIONS).toEqual(['2026-10-01']);
  });

  it('are ISO dates in ascending order', () => {
    for (const version of API_VERSIONS) {
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect([...API_VERSIONS].sort()).toEqual([...API_VERSIONS]);
  });

  it('name the latest version, which is the newest entry', () => {
    expect(latestApiVersion()).toBe('2026-10-01');
    expect(LATEST_API_VERSION).toBe(latestApiVersion());
    expect(LATEST_API_VERSION).toBe([...API_VERSIONS].sort().at(-1));
  });

  it('validate a requested version', () => {
    expect(apiVersionSchema.safeParse('2026-10-01').success).toBe(true);
    expect(apiVersionSchema.safeParse('2026-09-30').success).toBe(false);
    expect(isApiVersion('2026-10-01')).toBe(true);
    expect(isApiVersion('latest')).toBe(false);
    expect(isApiVersion(20261001)).toBe(false);
  });

  it('travel in the OpenVerify-Version header', () => {
    expect(API_VERSION_HEADER).toBe('openverify-version');
  });
});
