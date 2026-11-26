/**
 * K7B-11 (owner decision 13 after Workflow 7B): `explorer-url` comes from the resolved operator
 * setting, never from the process environment, and in production without
 * `OPENVERIFY_DASHBOARD_PUBLIC_URL` it is `null`, never `localhost`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { explorerUrlOf } from './shared.js';

const ID = 'grphq_01M5CK16P0D13FXHZSS4TCFBVH';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('explorerUrlOf (K7B-11)', () => {
  it('builds the console’s page of a result on the configured URL', () => {
    expect(explorerUrlOf(ID, 'https://console.example.test')).toBe(
      `https://console.example.test/graph/${ID}`,
    );
  });

  it('answers null with no configured URL, whatever the process environment holds', () => {
    vi.stubEnv('OPENVERIFY_DASHBOARD_PUBLIC_URL', 'https://elsewhere.example.test');

    expect(explorerUrlOf(ID, undefined)).toBeNull();
  });

  it('answers null for a URL that does not parse, never a guess', () => {
    expect(explorerUrlOf(ID, 'not a url')).toBeNull();
  });
});
