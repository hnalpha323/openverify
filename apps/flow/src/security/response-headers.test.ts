// @vitest-environment node
/**
 * C107.9: the flow's response headers. The compose-served flow is `vite preview`, so its config
 * sends them; the infra test (`infra/tests/flow-headers.test.sh`) checks them on the running
 * container.
 */
import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';
import { FLOW_RESPONSE_HEADERS } from './response-headers';

describe('the flow’s response headers (C107.9)', () => {
  it('forbid framing, the camera beyond this origin, geolocation, the microphone, referrers and sniffing', () => {
    expect(FLOW_RESPONSE_HEADERS).toEqual({
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('are what `vite preview` sends', () => {
    const config: UserConfig = viteConfig({ mode: 'production', command: 'serve' });

    expect(config.preview?.headers).toEqual(FLOW_RESPONSE_HEADERS);
  });
});
