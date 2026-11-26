/** `id_account_comparison` (R, fraud): the extraction against the account's fields (C34). */
import type { CheckResult } from '@openverify/core';
import { compareWithReference } from './comparison.js';
import type { GovernmentIdContext } from './context.js';

export function idAccountComparison(context: GovernmentIdContext): CheckResult {
  return compareWithReference(
    context,
    'id_account_comparison',
    context.input.references === undefined
      ? undefined
      : (context.input.references.accountFields ?? null),
  );
}
