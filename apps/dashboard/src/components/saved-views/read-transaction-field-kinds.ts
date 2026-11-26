import 'server-only';
import { TRANSACTION_TYPE_CHOICES, listTransactionTypes } from '../../lib/api/transactions';
import { nonPersonalTransactionFields } from './transaction-field-kinds';

/**
 * DA4 (K9-19): the transaction field keys a saved view may hold, from the environment's types (one
 * page of `TRANSACTION_TYPE_CHOICES`, as the transactions page reads them); `null` when they cannot
 * all be read, so every field filter stays personal.
 */
export async function readNonPersonalTransactionFields(): Promise<string[] | null> {
  try {
    const types = await listTransactionTypes(TRANSACTION_TYPE_CHOICES);
    return types.links.next === null ? nonPersonalTransactionFields(types.data) : null;
  } catch {
    return null;
  }
}
