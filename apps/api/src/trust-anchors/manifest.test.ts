/**
 * C62.7: the schema of `trust-anchors/manifest.json`, the committed, reviewable list of CSCA
 * master-list sources the operator's `trust-anchors:sync` fetches. Each source pins its
 * publisher's root CSCA certificate by URL and SHA-256 (never a list file, which goes stale), and
 * names the master-list content type and signer EKU it verifies. `bsi-de` is enabled by default;
 * the Netherlands, Italy and Switzerland are opt-in after legal review (decisions 38, 40).
 */
import { describe, expect, it } from 'vitest';
import { trustAnchorManifestSchema } from './manifest.js';

const SOURCE = {
  id: 'bsi-de',
  enabled: true,
  publisher: 'Bundesamt für Sicherheit in der Informationstechnik (BSI)',
  list_url:
    'https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/GermanMasterList.zip?__blob=publicationFile',
  root_certificate_url: 'https://www.bsi.bund.de/synthetic-root.cer',
  root_certificate_sha256: 'a'.repeat(64),
  fingerprint_checked_against: 'The publisher root certificate page (synthetic for this test)',
  content_type: '2.23.136.1.1.2',
  signer_eku: '2.23.136.1.1.3',
  terms: 'Commercial use allowed without advertising with the list; mirroring needs consent.',
};

describe('trust-anchors/manifest.json (C62.7)', () => {
  it('takes sources that pin their root and name what they verify', () => {
    const manifest = trustAnchorManifestSchema.parse({ schema_version: 1, sources: [SOURCE] });
    expect(manifest.sources[0]?.id).toBe('bsi-de');
  });

  it.each([
    ['a plain http list', { list_url: 'http://example.test/list.ml' }],
    ['a root without its SHA-256', { root_certificate_sha256: 'not hex' }],
    ['another content type', { content_type: '1.2.840.113549.1.7.1' }],
    ['another signer EKU', { signer_eku: '2.23.136.1.1.4' }],
    ['an id that is not a slug', { id: 'BSI DE' }],
    ['an unknown member', { mirror: 'https://cdn.example.test/list.ml' }],
  ])('refuses a source with %s', (_case, patch) => {
    expect(
      trustAnchorManifestSchema.safeParse({ schema_version: 1, sources: [{ ...SOURCE, ...patch }] })
        .success,
    ).toBe(false);
  });

  it('refuses two sources with one id', () => {
    expect(
      trustAnchorManifestSchema.safeParse({ schema_version: 1, sources: [SOURCE, SOURCE] }).success,
    ).toBe(false);
  });
});
