/**
 * C268.3, the method's items (e) and (g) (Workflow 11D load-harness): the seeded lists, written
 * through the importer's own writer (`createListItemWriter`: the same keys and normaliser version as
 * every other path, C99.1), and the published transaction type with its transactions, keyed by the
 * same searchable-field function the API's create uses. Every value is synthetic and made by the
 * generators below, which `load/scenarios/lists_match.py` and `transactions_write.py` mirror so a
 * probe or a search finds what was seeded.
 */
import type { FieldSchema, ListKind } from '@openverify/core';
import {
  createList,
  createTransaction,
  createTransactionType,
  createTransactionTypeVersion,
  publishTransactionTypeVersion,
  replaceTransactionFieldKeys,
} from '@openverify/db';
import { createOutboxOnlyPublisher } from '../../events/index.js';
import type { ListItemToWrite } from '../../ports.js';
import { stageListUpdated } from '../../workflows/actions/lists/list-updated.js';
import { createListItemWriter } from '../../services/lists/item-writer.js';
import { searchableFieldKeys, typedFields } from '../../services/transactions/write-checks.js';
import { countsFor, sandbox } from './counts.js';
import { environmentOf } from './record.js';
import type { LoadStepContext, LoadStepResult } from './steps.js';

const BATCH = 1000;

/** The importer routes the `lists-import` row loads, with their list kinds. */
export const IMPORT_LIST_KINDS: readonly (readonly [string, ListKind])[] = Object.freeze([
  ['email-addresses', 'email-address'],
  ['phone-numbers', 'phone-number'],
  ['names', 'name'],
  ['ip-addresses', 'ip-address'],
]);

/** Twenty country codes for the country list (ISO 3166-1 alpha-2). */
export const LOAD_COUNTRIES = Object.freeze([
  'AD', 'AE', 'AF', 'AG', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU',
  'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ',
]); // prettier-ignore

/**
 * Item `n`'s attributes for a list kind. Phone numbers come from ACMA's fictitious Australian mobile
 * block (+61 491 570 000 to 579 999: 10,000 numbers), addresses from 2001:db8:4d00::/48.
 */
export function itemAttributes(kind: ListKind, n: number): Record<string, unknown> {
  switch (kind) {
    case 'email-address':
      return { value: `listed-${String(n)}@example.com` };
    case 'phone-number':
      return { value: `+61491${String(570_000 + (n % 10_000))}` };
    case 'name':
      return {
        'name-first': `Loadfirst${String(n % 997)}`,
        'name-last': `Loadlast${String(n % 1009)}`,
      };
    case 'ip-address':
      return { value: `2001:db8:4d00::${n.toString(16)}` };
    case 'country':
      return { 'country-code': LOAD_COUNTRIES[n % LOAD_COUNTRIES.length] };
    default:
      throw new RangeError(`the load seed writes no ${kind} list`);
  }
}

/** The seeded lists of `load-a` and `load-b` sandbox, by kind (the method's item (e)). */
const SEEDED_KINDS: readonly ListKind[] = [
  'email-address',
  'phone-number',
  'name',
  'ip-address',
  'country',
];

export async function seedListsStep(ctx: LoadStepContext): Promise<LoadStepResult> {
  const { db, ids, record, settings, args } = ctx;
  const counts = countsFor(args.scale);
  const writer = createListItemWriter({ blindIndexKey: settings.blindIndexKey });
  const result: Record<string, number> = {};
  for (const organisation of ['load-a', 'load-b']) {
    const label = sandbox(organisation);
    const environmentId = environmentOf(record, label);
    for (const kind of SEEDED_KINDS) {
      if (record.refs[`list:${kind}:${label}`] !== undefined) {
        continue;
      }
      const list = await createList(db, environmentId, {
        id: ids.newId('lst'),
        type: kind,
        name: `Load ${kind}`,
        screenAtCompletion: true,
        ...(kind === 'name' ? { allowFuzzyNameFirst: true } : {}),
      });
      const total = Math.min(
        counts.listItems[kind as keyof typeof counts.listItems],
        kind === 'country' ? LOAD_COUNTRIES.length : Number.MAX_SAFE_INTEGER,
      );
      let written = 0;
      for (let start = 0; start < total; start += BATCH) {
        const items: ListItemToWrite[] = [];
        for (let n = start; n < Math.min(total, start + BATCH); n += 1) {
          items.push({
            attributes: itemAttributes(kind, n),
            creator: { type: 'importer' as const, id: list.id },
          });
        }
        const outcome = await db.transaction((tx) =>
          writer.insertItems(tx, { environmentId, listId: list.id, items }),
        );
        written += outcome.inserted.length;
      }
      // C127.12 (F20): every write that moves a list's version stages `list.updated`, the seed's
      // too, once for the list (written to the outbox; the stack's worker delivers it).
      if (written > 0) {
        await db.transaction((tx) =>
          stageListUpdated(tx, { events: createOutboxOnlyPublisher(tx) }, environmentId, [
            { listId: list.id, changeKind: 'items-added', items: written },
          ]),
        );
      }
      record.refs[`list:${kind}:${label}`] = list.id;
      result[`${kind}:${organisation}`] = written;
    }
  }
  return { counts: result, parts: 1 };
}

/** The published type's fields: three searchable strings (the method's item (g)). */
export const LOAD_TRANSACTION_FIELDS: readonly FieldSchema[] = Object.freeze([
  { type: 'string', key: 'payer_email', label: 'Payer email', config: { searchable: true } },
  {
    type: 'string',
    key: 'card_fingerprint',
    label: 'Card fingerprint',
    config: { searchable: true },
  },
  { type: 'string', key: 'merchant_id', label: 'Merchant', config: { searchable: true } },
]);

/** Transaction `n`'s field values, as `load/scenarios/transactions_write.py` makes them. */
export function transactionFields(n: number): Record<string, string> {
  return {
    payer_email: `payer-${String(n % 50_000)}@example.com`,
    card_fingerprint: `fp${String(n % 20_000).padStart(14, '0')}`,
    merchant_id: `merchant-${String(n % 500)}`,
  };
}

/** The published transaction type of `load-b` sandbox (called by the organisations step). */
export async function transactionTypeStep(ctx: LoadStepContext): Promise<void> {
  const { db, ids, clock, record } = ctx;
  if (record.refs['transaction-type:load-b'] !== undefined) {
    return;
  }
  const environmentId = environmentOf(record, sandbox('load-b'));
  const type = await createTransactionType(db, environmentId, {
    id: ids.newId('txntp'),
    name: 'Load payment',
  });
  const version = await createTransactionTypeVersion(db, environmentId, {
    id: ids.newId('txntpv'),
    transactionTypeId: type.id,
    version: 1,
    fieldSchemas: [...LOAD_TRANSACTION_FIELDS],
    statuses: ['created', 'approved', 'declined'],
    relationSchemas: [],
    allowCardLikeStrings: false,
  });
  await publishTransactionTypeVersion(db, environmentId, version.id, clock.now());
  record.refs['transaction-type:load-b'] = type.id;
  record.refs['transaction-type-version:load-b'] = version.id;
}

export async function seedTransactionsStep(
  ctx: LoadStepContext,
  part: number,
  parts: number,
): Promise<LoadStepResult> {
  const { db, ids, record, settings, args } = ctx;
  const total = countsFor(args.scale).transactions;
  const size = Math.ceil(total / parts);
  const from = (part - 1) * size;
  const to = Math.min(total, part * size);
  const environmentId = environmentOf(record, sandbox('load-b'));
  const typeId = record.refs['transaction-type:load-b'] ?? '';
  const versionId = record.refs['transaction-type-version:load-b'] ?? '';
  for (let start = from; start < to; start += BATCH) {
    await db.transaction(async (tx) => {
      for (let n = start; n < Math.min(to, start + BATCH); n += 1) {
        const fields = typedFields(transactionFields(n), LOAD_TRANSACTION_FIELDS);
        const created = await createTransaction(tx, environmentId, {
          id: ids.newId('txn'),
          transactionTypeId: typeId,
          transactionTypeVersionId: versionId,
          referenceId: `load-txn-seed-${String(n)}`,
          status: 'created',
          fields,
          tags: [],
        });
        await replaceTransactionFieldKeys(
          tx,
          environmentId,
          created.id,
          [],
          searchableFieldKeys(
            settings.blindIndexKey,
            environmentId,
            LOAD_TRANSACTION_FIELDS,
            fields,
          ),
        );
      }
    });
  }
  return { counts: { transactions: to - from }, parts };
}
