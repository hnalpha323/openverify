/**
 * `dashboard-lists-transactions`' transaction helpers for `ui-transactions.spec.ts` (Workflow 7C,
 * C108): a published type made through the API: its first draft, named by the `latest-version`
 * relationship, takes the content and is published. Every value is synthetic.
 */
import type { OpenVerifyClient } from '@openverify/node';

/** A string field, a number and a write-once note: what the console spec reads back. */
export const UI_FIELD_SCHEMAS = [
  { type: 'string', key: 'note', label: 'Note' },
  { type: 'number', key: 'amount', label: 'Amount' },
] as const;

export const UI_STATUSES = ['created', 'approved', 'declined'] as const;

/** Creates a type named `name` and publishes its first draft with the spec's content. */
export async function publishedType(client: OpenVerifyClient, name: string): Promise<string> {
  const { data: type } = await client.transactionTypes.create({ name });
  const draftId = type.relationships?.['latest-version'].data.id ?? '';
  await client.transactionTypes.versions.update(draftId, {
    'field-schemas': [...UI_FIELD_SCHEMAS],
    statuses: [...UI_STATUSES],
  });
  await client.transactionTypes.versions.publish(draftId);
  return type.id;
}
