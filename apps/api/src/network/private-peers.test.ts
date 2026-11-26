/**
 * C93.1 (P05): the trust-mode warnings. Every log names the trust mode and counts only, never an
 * address.
 */
import { describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../jobs/testing.js';
import { PRIVATE_PEER_WARN_AFTER, warnOnPrivatePeers } from './private-peers.js';

describe('warnOnPrivatePeers', () => {
  it('warns at startup about a hop count and about trust-all, and not otherwise', () => {
    for (const [trustProxy, warned] of [
      [false, false],
      [['10.0.0.0/8'], false],
      [2, true],
      [true, true],
    ] as const) {
      const logger = createCapturingLogger();
      warnOnPrivatePeers(logger, trustProxy as never);
      expect(logger.entries.filter((entry) => entry.level === 'warn').length > 0).toBe(warned);
    }
    const logger = createCapturingLogger();
    warnOnPrivatePeers(logger, true);
    expect(logger.entries[0]?.message).toMatch(/client_address_untrusted/);
    expect(logger.entries[0]?.object).toEqual({ trustMode: 'trust-all' });
  });

  it('warns once when production sessions keep arriving from private peers', () => {
    const logger = createCapturingLogger();
    const watch = warnOnPrivatePeers(logger, false);
    for (let index = 0; index < PRIVATE_PEER_WARN_AFTER - 1; index += 1) {
      watch.observe({ environmentKind: 'production', addressIsPrivate: true });
    }
    expect(logger.entries).toEqual([]);
    watch.observe({ environmentKind: 'production', addressIsPrivate: true });
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        object: { trustMode: 'socket', privateSessions: PRIVATE_PEER_WARN_AFTER },
        message:
          'production sessions keep arriving from private addresses: a proxy in front of the API is probably not trusted (OPENVERIFY_TRUST_PROXY), so every network fact describes the proxy',
      },
    ]);
    for (let index = 0; index < PRIVATE_PEER_WARN_AFTER * 2; index += 1) {
      watch.observe({ environmentKind: 'production', addressIsPrivate: true });
    }
    expect(logger.entries).toHaveLength(1);
  });

  it('counts only production sessions in a row, and starts again after a public one', () => {
    const logger = createCapturingLogger();
    const watch = warnOnPrivatePeers(logger, ['192.0.2.0/24']);
    for (let index = 0; index < PRIVATE_PEER_WARN_AFTER * 3; index += 1) {
      watch.observe({ environmentKind: 'sandbox', addressIsPrivate: true });
      watch.observe({
        environmentKind: 'production',
        addressIsPrivate: index % PRIVATE_PEER_WARN_AFTER !== 0,
      });
    }
    expect(logger.entries).toEqual([]);
  });
});
