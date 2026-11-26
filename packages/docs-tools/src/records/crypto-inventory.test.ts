/**
 * C276.1 (Workflow 11E, `docs-records`): the cryptographic inventory names every secret
 * `config-registry.ts` marks (pattern entries included), every blind-index label, every token
 * prefix and every data-key column, and cites only paths, commands and variables that exist.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG_REGISTRY } from '../../../../apps/api/src/config-registry.js';
import { ENCRYPTED_COLUMNS } from '../../../../packages/db/src/encrypted-columns.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { COLUMN_CLASSES } from './classification.js';
import {
  CRYPTO_INVENTORY_PATH,
  checkCryptoInventory,
  cryptoInventoryRequirements,
} from './crypto-inventory.js';

const repo = createRepository(REPOSITORY_ROOT);

describe('what the inventory must name', () => {
  const spans = cryptoInventoryRequirements(repo).map((item) => item.span);

  it('includes every secret config-registry.ts marks, pattern entries by their pattern', () => {
    const secrets = CONFIG_REGISTRY.filter((entry) => entry.secret).map((entry) => entry.name);
    expect(secrets.length).toBeGreaterThan(20);
    expect(secrets).toContain('OPENVERIFY_SEED_{ROLE}_PASSWORD');
    for (const name of secrets) {
      expect(spans, name).toContain(name);
    }
  });

  it('includes every blind-index label of packages/db/src/blind-index.ts', () => {
    expect(spans).toContain('openverify/blind-index/v1');
    expect(spans).toContain('openverify/identifier-transaction-field/v1');
    expect(spans).toContain('openverify/audit-ip/v1');
  });

  it('includes every token prefix', () => {
    for (const prefix of [
      'ovs_',
      'ovu_',
      'ovo_',
      'ovm_',
      'ovi_',
      'ovh_',
      'wbhsec_',
      'ov_sbx_',
      'ov_prod_',
      'ovsb_',
    ]) {
      expect(spans, prefix).toContain(prefix);
    }
  });

  it('includes every data-key column and every sealed secret column', () => {
    const files = ENCRYPTED_COLUMNS.filter((entry) => entry.aad === 'file').map(
      (entry) => `${entry.table}.${entry.column}`,
    );
    const secrets = Object.entries(COLUMN_CLASSES)
      .filter(([, entry]) => entry.class === 'secrets')
      .map(([name]) => name);
    for (const name of [...files, ...secrets]) {
      expect(spans, name).toContain(name);
    }
  });
});

describe('the committed inventory', () => {
  it('passes its record test', () => {
    const result = checkCryptoInventory(repo);
    expect(result.status).toBe('built');
    expect(result.findings).toEqual([]);
  });

  it('fails when a required name is missing', () => {
    const fixture = createMemoryRepository({
      [CRYPTO_INVENTORY_PATH]: '# Cryptographic inventory\n\nNothing yet.\n',
      'apps/api/src/services/redaction.test-support.ts': '',
      'packages/db/src/blind-index.ts': "export const A = 'openverify/example/v1';\n",
      'packages/contracts/src/tokens.ts': "export const X_PREFIX = 'ovx_';\n",
      'packages/db/src/api-keys.ts': '',
      'packages/contracts/src/sso.ts': '',
    });
    const result = checkCryptoInventory(fixture);
    const messages = result.findings.map((finding) => finding.message).join('\n');
    expect(messages).toContain('OPENVERIFY_KEK');
    expect(messages).toContain('openverify/example/v1');
    expect(messages).toContain('ovx_');
  });
});
