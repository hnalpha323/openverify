// @vitest-environment node
/**
 * C96.5, owner decision 24: the flow draws the handoff QR with the encoder that added the least to
 * its gzipped bundle. flow-handoff measured the three candidates (docs/tdd/phase7-flow-handoff.tdd.md,
 * "The QR measurement": lean-qr 2.7.4 +3,557 B, uqr 0.1.3 +3,795 B, qrcode 1.5.4 +9,501 B), and
 * integration-7a removes the two that lost from the flow. The dashboard keeps qrcode for its TOTP
 * enrolment code (C22).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const declared = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
];

describe('the handoff QR encoder (C96.5, decision 24)', () => {
  it('is lean-qr, the smallest addition to the flow bundle', () => {
    expect(manifest.dependencies?.['lean-qr']).toBe('catalog:');
  });

  it('leaves the two encoders that lost the measurement out of the flow', () => {
    expect(declared.filter((name) => ['qrcode', '@types/qrcode', 'uqr'].includes(name))).toEqual(
      [],
    );
  });
});
