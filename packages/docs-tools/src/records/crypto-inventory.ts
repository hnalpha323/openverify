/**
 * C276.1 (Workflow 11E, `docs-records`): the record test of `docs/security/crypto-inventory.md`,
 * a hand-written page whose facts the repository holds. It must name:
 *
 * - every variable `apps/api/src/config-registry.ts` marks `secret` (pattern entries by their
 *   pattern), C276.1's own test;
 * - every HMAC label of `packages/db/src/blind-index.ts` (`openverify/<name>/v1`);
 * - every token prefix of `packages/contracts/src/tokens.ts`, the API keys' prefixes
 *   (`packages/db/src/api-keys.ts`) and the SSO browser binding's (`packages/contracts/src/sso.ts`);
 * - every sealed column of the `secrets` class and every data-key (`file`) column of
 *   `ENCRYPTED_COLUMNS`;
 *
 * and cite only repository paths, `pnpm` scripts and configuration variables that exist.
 */
import { CONFIG_REGISTRY } from '../../../../apps/api/src/config-registry.js';
import { ENCRYPTED_COLUMNS } from '../../../db/src/encrypted-columns.js';
import type { CheckResult, Repository } from '../types.js';
import {
  commandFindings,
  draftFindings,
  pathFindings,
  requiredSpanFindings,
  variableFindings,
} from './checks.js';
import { COLUMN_CLASSES } from './classification.js';

export const CRYPTO_INVENTORY_PATH = 'docs/security/crypto-inventory.md';

/** The files whose labels and prefixes the inventory must name. */
export const CRYPTO_SOURCES = Object.freeze({
  blindIndex: 'packages/db/src/blind-index.ts',
  tokens: 'packages/contracts/src/tokens.ts',
  apiKeys: 'packages/db/src/api-keys.ts',
  sso: 'packages/contracts/src/sso.ts',
});

interface Requirement {
  readonly span: string;
  readonly why: string;
}

const text = (repo: Repository, path: string): string =>
  repo.exists(path) ? repo.readText(path) : '';

const unique = (items: readonly Requirement[]): readonly Requirement[] => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.span) ? false : (seen.add(item.span), true)));
};

/** What the inventory must name, each with why: secrets, labels, prefixes and data keys. */
export function cryptoInventoryRequirements(repo: Repository): readonly Requirement[] {
  const secrets = CONFIG_REGISTRY.filter((entry) => entry.secret).map((entry) => ({
    span: entry.name,
    why: 'a secret apps/api/src/config-registry.ts marks',
  }));
  const labels = [
    ...text(repo, CRYPTO_SOURCES.blindIndex).matchAll(/'(openverify\/[a-z0-9-]+\/v1)/g),
  ].map((match) => ({
    span: match[1] ?? '',
    why: `an HMAC label of ${CRYPTO_SOURCES.blindIndex}`,
  }));
  const prefixes = [
    ...[...text(repo, CRYPTO_SOURCES.tokens).matchAll(/_PREFIX = '([a-z_]+)'/g)].map((match) => ({
      span: match[1] ?? '',
      why: `a token prefix of ${CRYPTO_SOURCES.tokens}`,
    })),
    ...[...text(repo, CRYPTO_SOURCES.apiKeys).matchAll(/(?:sandbox|production): '([a-z_]+)'/g)].map(
      (match) => ({ span: match[1] ?? '', why: `an API key prefix of ${CRYPTO_SOURCES.apiKeys}` }),
    ),
    ...[...text(repo, CRYPTO_SOURCES.sso).matchAll(/_PREFIX = '([a-z_]+)'/g)].map((match) => ({
      span: match[1] ?? '',
      why: `the SSO browser binding's prefix (${CRYPTO_SOURCES.sso})`,
    })),
  ];
  const dataKeys = ENCRYPTED_COLUMNS.filter((entry) => entry.aad === 'file').map((entry) => ({
    span: `${entry.table}.${entry.column}`,
    why: 'a data key of an object in storage (ENCRYPTED_COLUMNS, aad file)',
  }));
  const sealedSecrets = Object.entries(COLUMN_CLASSES)
    .filter(([, entry]) => entry.class === 'secrets')
    .map(([name]) => ({ span: name, why: 'a sealed column of the secrets class' }));
  return unique([...secrets, ...labels, ...prefixes, ...dataKeys, ...sealedSecrets]);
}

/** The inventory's record test (C276.1). */
export function checkCryptoInventory(repo: Repository): CheckResult {
  const page = text(repo, CRYPTO_INVENTORY_PATH);
  return {
    name: 'crypto-inventory',
    status: 'built',
    findings: [
      ...draftFindings(CRYPTO_INVENTORY_PATH, page),
      ...requiredSpanFindings(CRYPTO_INVENTORY_PATH, page, cryptoInventoryRequirements(repo)),
      ...pathFindings(repo, CRYPTO_INVENTORY_PATH, page),
      ...commandFindings(repo, CRYPTO_INVENTORY_PATH, page),
      ...variableFindings(CRYPTO_INVENTORY_PATH, page),
    ],
  };
}
