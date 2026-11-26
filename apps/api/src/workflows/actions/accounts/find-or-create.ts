/**
 * C127.6: Find or Create Account, by account type and identifier; it never merges accounts. A
 * `reference-id` is the account's own. Account fields are sealed and `reference-id` is a plain column,
 * so a declared identifier field is found through a keyed digest of it, `<field-key>:<HMAC>`, which
 * the creation writes: the value itself stays sealed in `fields` (rule 3). A rotated blind-index key
 * finds nothing and creates a new account, which is the accepted cost of never merging. (Default, on
 * the owner's review list.)
 */
import { findAccountByReferenceId, identifierKey } from '@openverify/db';
import {
  findOrCreateAccountConfigSchema,
  type FindOrCreateAccountConfig,
} from '@openverify/workflow-engine/actions';
import type { StagedEvent } from '../../../events/index.js';
import { accountChangeIn, createAccountInTx } from '../../../services/accounts.js';
import type { TransactionActionHandler } from '../../engine/action-port.js';
import { recordCreatedObjectInTx } from '../children.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';

const referenceOf = (
  { identifier, 'account-type-id': accountTypeId }: FindOrCreateAccountConfig,
  environmentId: string,
  key: Uint8Array,
): string => {
  if (identifier.kind === 'reference-id') {
    return identifier.value;
  }
  const digest = identifierKey(key, {
    environmentId,
    kind: 'account-identifier',
    input: `${accountTypeId}|${identifier['field-key']}|${identifier.value}`,
  });
  return `${identifier['field-key']}:${digest}`;
};

export const FIND_OR_CREATE_ACCOUNT_HANDLER: TransactionActionHandler = {
  key: 'find_or_create_account',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const config = configOf(context, findOrCreateAccountConfigSchema);
    const deps = apiDepsOf(context);
    const { environmentId, acting } = context;
    const referenceId = referenceOf(config, environmentId, deps.blindIndexKey);
    const found = await findAccountByReferenceId(tx, environmentId, referenceId);
    if (found !== null) {
      return {
        kind: 'succeeded',
        output: { 'account-id': found.id, outcome: 'found' },
        subjects: [{ subjectId: found.id, source: 'read' }],
      };
    }
    const staged: StagedEvent[] = [];
    const { identifier } = config;
    const view = await refusing(() =>
      createAccountInTx(deps, accountChangeIn(tx, deps, acting.ctx, acting.actor, staged), {
        'account-type-id': config['account-type-id'],
        'reference-id': referenceId,
        fields: {
          ...(config.fields as Record<string, never> | undefined),
          ...(identifier.kind === 'field' ? { [identifier['field-key']]: identifier.value } : {}),
        },
      }),
    );
    await recordCreatedObjectInTx(tx, context, 'accounts', { id: view.account.id });
    return {
      kind: 'succeeded',
      output: { 'account-id': view.account.id, outcome: 'created' },
      staged,
      subjects: [{ subjectId: view.account.id, source: 'written' }],
    };
  },
};
