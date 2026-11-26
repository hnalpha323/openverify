/**
 * C62.7: `pnpm --filter @openverify/api trust-anchors:sync` (`scripts/trust-anchors-sync.ts`) and
 * its wrapper `scripts/fetch_trust_anchors.sh`: the command line, a sync of the manifest's sources
 * and an operator import, over synthetic sources a scripted outbound client serves. Vitest runs
 * `src/**` tests, so the script's tests live here. Nothing touches the network.
 */
import { accessSync, constants, readFileSync } from 'node:fs';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TrustAnchorSyncUsageError,
  parseTrustAnchorSyncArgs,
  runTrustAnchorSync,
  type TrustAnchorSyncRuntime,
} from '../scripts/trust-anchors-sync.js';
import {
  scriptedOutboundHttp,
  syntheticSource,
  type ScriptedRoute,
  type SyntheticSource,
} from './trust-anchors/testing.js';

const repository = (path: string) => new URL(`../../../${path}`, import.meta.url);

describe('parseTrustAnchorSyncArgs', () => {
  it('syncs every enabled source by default', () => {
    expect(parseTrustAnchorSyncArgs([])).toEqual({ source: null, import: null });
  });

  it('reads --source, and --import with its --root, with = or a separate value', () => {
    expect(parseTrustAnchorSyncArgs(['--source', 'bsi-de'])).toEqual({
      source: 'bsi-de',
      import: null,
    });
    expect(
      parseTrustAnchorSyncArgs(['--source=npkd-nl', '--import', 'list.ml', '--root=root.pem']),
    ).toEqual({ source: 'npkd-nl', import: { file: 'list.ml', root: 'root.pem' } });
  });

  it.each([
    [['--source'], '--source needs a value.'],
    [['--source=BSI DE'], '--source must be a manifest source id such as bsi-de.'],
    [['--import=list.ml'], '--import needs --root, the PEM root certificate to verify it with.'],
    [['--root=root.pem'], '--root is read only with --import.'],
    [['--refresh'], 'Unknown argument --refresh.'],
  ])('refuses %j', (argv, message) => {
    expect(() => parseTrustAnchorSyncArgs(argv)).toThrow(TrustAnchorSyncUsageError);
    expect(() => parseTrustAnchorSyncArgs(argv)).toThrow(message);
  });
});

describe('runTrustAnchorSync (C62.7)', () => {
  const NOW = new Date('2026-10-20T12:00:00.000Z');
  const SIGNED = new Date('2026-10-01T08:00:00.000Z');
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  function runtime(
    source: SyntheticSource,
    routes: ReadonlyMap<string, ScriptedRoute>,
    files: ReadonlyMap<string, Uint8Array> = new Map(),
  ) {
    const lines: string[] = [];
    const { http, requests } = scriptedOutboundHttp(routes);
    const value: TrustAnchorSyncRuntime = {
      db: database.db,
      outboundHttp: http,
      clock: { now: () => NOW },
      manifest: source.manifest(),
      allowIcaoCrls: false,
      readFile: (path) => {
        const bytes = files.get(path);
        return bytes === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(bytes);
      },
      out: (line) => lines.push(line),
    };
    return { runtime: value, lines, requests };
  }

  it('syncs every enabled source of the manifest and prints one line each', async () => {
    const source = syntheticSource('cli/root', NOW);
    const { runtime: run, lines } = runtime(
      source,
      source.routes(source.list([source.root], SIGNED)),
    );

    const outcomes = await runTrustAnchorSync({ source: null, import: null }, run);

    expect(outcomes).toMatchObject([{ sourceId: 'bsi-de', outcome: 'accepted', anchorsSeen: 1 }]);
    expect(lines).toEqual(['bsi-de: accepted, 1 anchors, 0 withdrawn, 1 CRLs updated, 0 refused']);
  });

  it('refuses a --source the manifest does not name', async () => {
    const source = syntheticSource('cli/unknown', NOW);
    const { runtime: run } = runtime(source, new Map());

    await expect(runTrustAnchorSync({ source: 'ita', import: null }, run)).rejects.toBeInstanceOf(
      TrustAnchorSyncUsageError,
    );
  });

  it('imports a list from a file, verified against the --root certificate, fetching only its CRLs', async () => {
    const source = syntheticSource('cli/import', NOW);
    const list = source.list([source.root], SIGNED);
    const { runtime: run, requests } = runtime(
      source,
      source.routes(list),
      new Map([
        ['list.ml', list],
        ['root.pem', source.root.der],
      ]),
    );

    const outcomes = await runTrustAnchorSync(
      { source: null, import: { file: 'list.ml', root: 'root.pem' } },
      run,
    );

    expect(outcomes).toMatchObject([
      { sourceId: 'operator-import', outcome: 'accepted', anchorsSeen: 1 },
    ]);
    expect(requests.map((request) => request.url)).toEqual(['http://crl.example.test/de.crl']);
  });
});

describe('the script entries (C62.7)', () => {
  it('runs scripts/trust-anchors-sync.ts as trust-anchors:sync, with the .env if present', () => {
    const manifest = JSON.parse(readFileSync(repository('apps/api/package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['trust-anchors:sync']).toBe(
      'tsx --conditions=@openverify/source --env-file-if-exists=../../.env scripts/trust-anchors-sync.ts',
    );
  });

  it('wraps it in an executable scripts/fetch_trust_anchors.sh that passes its arguments on', () => {
    const wrapper = repository('scripts/fetch_trust_anchors.sh');
    expect(() => {
      accessSync(wrapper, constants.X_OK);
    }).not.toThrow();
    const text = readFileSync(wrapper, 'utf8');
    expect(text.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(text).toContain('set -euo pipefail');
    expect(text).toContain('exec pnpm --filter @openverify/api trust-anchors:sync "$@"');
  });
});
