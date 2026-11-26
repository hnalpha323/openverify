/**
 * C240.5 (V04), Workflow 11A Stage 1b (C) (`foundation-11a`): one cross-tenant path, held on the tree
 * itself (the ESLint rule in `phase5Config()` holds it in the editor and in lint).
 *
 * - The Connect repositories' cross-environment functions (`@openverify/db/cross-env`, the
 *   `*.cross-env.ts` modules) and the counterparty entry points of the event and audit writers
 *   (`services/connect/counterparty-events.ts`, `services/connect/audit.ts`) are imported by
 *   `services/connect/cross-tenant.ts` alone (and the db's own entry that serves the twins).
 * - `cross-tenant.ts` declares every entry point C240.5 names; each is a stub until `api-connect`
 *   builds it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../../../', import.meta.url).pathname;
const SOURCE_FOLDERS = ['apps', 'packages'];
const SKIPPED = new Set(['node_modules', 'dist', '.next', 'coverage', 'build', '.turbo']);

function sourceFiles(folder: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(folder)) {
    if (SKIPPED.has(name)) continue;
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

/** Every module specifier a file imports or re-exports, static or dynamic with a literal. */
const specifiersOf = (source: string): string[] =>
  [
    ...source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1] ?? '');

const isCrossTenantModule = (specifier: string): boolean =>
  specifier === '@openverify/db/cross-env' ||
  /\.cross-env(?:\.[jt]s)?$/.test(specifier) ||
  /(?:^|\/)(?:services\/connect\/|\.\/)(?:counterparty-events|audit)(?:\.[jt]s)?$/.test(specifier);

const ALLOWED = new Set([
  'apps/api/src/services/connect/cross-tenant.ts',
  'packages/db/src/cross-env.ts',
]);

describe('the cross-tenant import boundary on the tree (C240.5)', () => {
  it('lets only cross-tenant.ts import the cross-environment modules and counterparty writers', () => {
    const offenders: string[] = [];
    for (const folder of SOURCE_FOLDERS) {
      for (const file of sourceFiles(join(ROOT, folder))) {
        const path = relative(ROOT, file);
        if (ALLOWED.has(path) || path.endsWith('.test.ts')) continue;
        const inConnect = path.startsWith('apps/api/src/services/connect/');
        for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
          const sibling = /^\.\/(?:counterparty-events|audit)(?:\.[jt]s)?$/.test(specifier);
          if ((sibling && inConnect) || (!sibling && isCrossTenantModule(specifier))) {
            offenders.push(`${path} imports ${specifier}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the imports it guards, so it is not vacuous', () => {
    const crossTenant = readFileSync(
      join(ROOT, 'apps/api/src/services/connect/cross-tenant.ts'),
      'utf8',
    );
    const guarded = specifiersOf(crossTenant).filter(
      (specifier) =>
        isCrossTenantModule(specifier) || /^\.\/(?:counterparty-events|audit)/.test(specifier),
    );
    expect(guarded.sort()).toEqual([
      './audit.js',
      './counterparty-events.js',
      '@openverify/db/cross-env',
    ]);
  });
});

describe('cross-tenant.ts: the entry points C240.5 names', () => {
  const ENTRY_POINTS = [
    // C232.2, C232.3: the destination's reads of an inbound token, which lives in the source environment.
    'getInboundShareToken',
    'listInboundShareTokens',
    // C233.4: the peek's read of the source's current rows.
    'readPeekSource',
    // C234.2: the redemption's re-read of the source, the connection and the consent records.
    'readRedemptionSource',
    // C239.1: the counterparty's staged events; C240.4: its audit entries.
    'stageCounterpartyEvents',
    'appendCounterpartyAudit',
    // C231.4: a deactivation expiring the source's created tokens.
    'expireTokensOnDeactivation',
    // C237.2: a withdrawal expiring the other side's token.
    'expireTokenOnWithdrawal',
    // C253.2 (11B's access export): the tokens and consent records touching these objects.
    'listSharesTouching',
    // api-connect (checkpoint 1): the counterparty's names, environments and opt-in a connection
    // reads, and the facts and the policy of an inbound token (C230.2, C231.1, C232.1, C232.3).
    'connectionOrganizationNames',
    'counterpartyEnvironments',
    'destinationEnvironmentOfKind',
    'acceptsInboundConnections',
    'inboundShareTokenFacts',
    'inboundShareTokenPolicy',
    // api-connect (checkpoint 3): the peek's lock and count of an inbound token (C233.5).
    'lockInboundShareToken',
    'countPeek',
    // integration-11a: the redemption's writes of an inbound token (C234.1, C234.2) and the
    // client-side reservation (C238.5).
    'markInboundShareToken',
    'reserveInboundShareToken',
  ];

  it('declares each, and nothing else reaches another environment', async () => {
    const modulePath = './cross-tenant.js';
    const module = (await import(/* @vite-ignore */ modulePath)) as {
      crossTenant: Record<string, (...args: unknown[]) => Promise<unknown>>;
    };
    expect(Object.keys(module.crossTenant).sort()).toEqual([...ENTRY_POINTS].sort());
  });
});
