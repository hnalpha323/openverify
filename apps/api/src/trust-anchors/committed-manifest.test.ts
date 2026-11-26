/**
 * C62.7: the committed `trust-anchors/manifest.json`. It names the four free sources with their
 * publishers' pinned root CSCAs, `bsi-de` on and the others off until the owner's legal review
 * (decisions 38-40), and holds no list, certificate or CRL: only URLs, SHA-256 pins and our notes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { trustAnchorManifestSchema } from './manifest.js';

const PATH = new URL('../../../../trust-anchors/manifest.json', import.meta.url);

describe('the committed trust-anchor manifest (C62.7)', () => {
  it('parses, and enables bsi-de only', () => {
    const manifest = trustAnchorManifestSchema.parse(JSON.parse(readFileSync(PATH, 'utf8')));

    expect(manifest.sources.map((source) => [source.id, source.enabled])).toEqual([
      ['bsi-de', true],
      ['npkd-nl', false],
      ['ita', false],
      ['che', false],
    ]);
    expect(new Set(manifest.sources.map((source) => source.root_certificate_sha256)).size).toBe(4);
    for (const source of manifest.sources) {
      expect(source.fingerprint_checked_against).toMatch(/2026-10-24/u);
    }
  });

  it('holds pins only, never a certificate, list or CRL', () => {
    const text = readFileSync(PATH, 'utf8');

    expect(text.length).toBeLessThan(16 * 1024);
    expect(text).not.toMatch(/BEGIN CERTIFICATE|BEGIN X509 CRL/u);
    // No long base64 run, as an embedded DER object would be.
    expect(text).not.toMatch(/[A-Za-z0-9+/]{120,}/u);
  });
});
