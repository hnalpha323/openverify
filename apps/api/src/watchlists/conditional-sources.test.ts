/**
 * C254.2 (Workflow 11B, ingestion-11b; decision 39): which sources of `watchlists/sources.json` opt in
 * to conditional requests, and why. A source opts in only when its publisher serves a strong `ETag`
 * or a `Last-Modified` on the URL the sync requests, measured in
 * `docs/research/phase6-data-sources.md`, and the answer comes from that URL itself (the stream
 * client carries no request header over its one redirect, so a validator never reaches a redirect
 * target):
 *
 * - `uk-sanctions-list`: 200 straight from `sanctionslist.fcdo.gov.uk` with `ETag` and
 *   `Last-Modified` (section 4.2). Opted in.
 * - `ofac-sdn`, `ofac-consolidated`: every export answers 302 to a pre-signed S3 URL (section
 *   1.1); validators live on the storage object, which never sees the request's headers. Not opted
 *   in.
 * - `eu-fsf`: no validator is recorded on the file (section 3); its checksum is behind the login.
 *   Not opted in.
 * - `un-sc`: redirected to blob storage, and its `Last-Modified` and `ETag` change daily without a
 *   content change (section 2.3); also locked off (C254.1). Not opted in.
 * - `wikidata-pep`: a live SPARQL query, never a file. The sandbox lists: no URL. Not opted in.
 *
 * A 304 is the publisher's statement only; the forced full check (`watchlist-full-check-hours`) is
 * the platform's proof (C254.3).
 */
import { describe, expect, it } from 'vitest';
import { watchlistManifest } from './manifest.js';

describe('the conditional sources (C254.2)', () => {
  it('opts in only the UK list', () => {
    const conditional = watchlistManifest()
      .sources.filter((source) => source.conditional === true)
      .map((source) => source.id);
    expect(conditional).toEqual(['uk-sanctions-list']);
  });

  it('opts in no source whose request is redirected, live or local', () => {
    for (const source of watchlistManifest().sources) {
      if (source.conditional !== true) continue;
      expect(source.redirect_host, source.id).toBeNull();
      expect(source.urls, source.id).toHaveLength(1);
      expect(source.parser, source.id).not.toBe('wikidata-sparql');
      expect(source.enabled_by_default, source.id).toBe(true);
    }
  });
});
