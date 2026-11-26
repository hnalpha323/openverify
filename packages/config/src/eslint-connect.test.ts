/**
 * C240.5 (V04), Workflow 11A Stage 1b (C): one cross-tenant path. The Connect repositories'
 * cross-environment functions (`@openverify/db/cross-env`, the `*.cross-env.ts` modules) and the
 * counterparty entry points of the event and audit writers (`services/connect/counterparty-events.ts`,
 * `services/connect/audit.ts`) may be imported only by `apps/api/src/services/connect/cross-tenant.ts`.
 * `phase5Config()` carries the `no-restricted-imports` rule that holds it; this pins it with ESLint's
 * `Linter` on synthetic code. The source test beside `cross-tenant.ts` holds the tree itself.
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { phase5Config } from '../eslint/phase5-rules.js';

const linter = new Linter({ configType: 'flat' });
const config: Linter.Config[] = [
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser: tseslint.parser } },
  ...phase5Config(),
];

const rulesOf = (code: string, filename: string) =>
  linter.verify(code, config, { filename }).map((message) => message.ruleId);

const CROSS_TENANT = 'apps/api/src/services/connect/cross-tenant.ts';

describe('the cross-tenant import boundary (C240.5)', () => {
  it('is a rule of phase5Config(), which the root config spreads', () => {
    const blocks = phase5Config().filter(
      (block) => block.rules?.['no-restricted-imports'] !== undefined,
    );
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.every((block) => block.ignores?.includes(CROSS_TENANT) === true)).toBe(true);
  });

  it.each([
    [
      "import { connectShareTokensCrossEnv } from '@openverify/db/cross-env';",
      'apps/api/src/services/connect/peek.ts',
    ],
    [
      "import * as tokens from '@openverify/db/cross-env';",
      'apps/api/src/routes/server/connect-share-tokens.ts',
    ],
    [
      "import { getInboundShareToken } from '../../../packages/db/src/repositories/connect-share-tokens.cross-env.js';",
      'apps/api/src/services/connect/redeem.ts',
    ],
    [
      "import { getInboundShareToken } from './repositories/connect-share-tokens.cross-env.js';",
      'packages/db/src/index.ts',
    ],
    [
      "import { stageCounterpartyEvent } from './counterparty-events.js';",
      'apps/api/src/services/connect/share-tokens.ts',
    ],
    [
      "import { appendCounterpartyAuditEntry } from './audit.js';",
      'apps/api/src/services/connect/connections.ts',
    ],
    [
      "import { appendCounterpartyAuditEntry } from '../services/connect/audit.js';",
      'apps/api/src/jobs/connect-token-expiry.ts',
    ],
    [
      "import { stageCounterpartyEvent } from '../../services/connect/counterparty-events.js';",
      'apps/api/src/jobs/connect-redeem/process.ts',
    ],
    [
      "import { getInboundShareToken } from '@openverify/db/cross-env';",
      'apps/dashboard/src/app/connect/page.tsx',
    ],
  ])('refuses %s in %s', (code, filename) => {
    expect(rulesOf(`${code}\n`, filename)).toContain('no-restricted-imports');
  });

  it.each([
    "import { connectShareTokensCrossEnv } from '@openverify/db/cross-env';",
    "import { stageCounterpartyEvent } from './counterparty-events.js';",
    "import { appendCounterpartyAuditEntry } from './audit.js';",
  ])('lets cross-tenant.ts import %s', (code) => {
    expect(rulesOf(`${code}\n`, CROSS_TENANT)).not.toContain('no-restricted-imports');
  });

  it.each([
    [
      "import { createShareToken } from '@openverify/db';",
      'apps/api/src/services/connect/share-tokens.ts',
    ],
    [
      "import { appendAuditLog } from '@openverify/db';",
      'apps/api/src/services/connect/connections.ts',
    ],
    [
      "import { workflowAudit } from './audit.js';",
      'apps/api/src/workflows/definitions/service.ts',
    ],
    [
      "import { queueAudit } from '../../../services/cases/queues/audit.js';",
      'apps/api/src/workflows/actions/cases/steps.ts',
    ],
    ["import { crossTenant } from './cross-tenant.js';", 'apps/api/src/services/connect/peek.ts'],
  ])('leaves an ordinary import alone: %s in %s', (code, filename) => {
    expect(rulesOf(`${code}\n`, filename)).not.toContain('no-restricted-imports');
  });
});
