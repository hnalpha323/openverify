/** C127.8: what an operator of `update_object` reads first: the object's custom fields. */
import { getAccount, getCaseRow, getInquiry, getTransaction, type Db } from '@openverify/db';
import type { ActionContext } from '../../engine/action-port.js';

/**
 * K8-18: a case keeps each field typed as stored (`{ type, value }`, C136.4), and its update takes the
 * plain value, so an operator reads the value: `append`, `push` and `remove` start from what it holds.
 */
function caseFieldValues(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, typed]) => [
      key,
      typeof typed === 'object' && typed !== null && 'value' in typed ? typed.value : typed,
    ]),
  );
}

export async function getCustomFields(
  tx: Db,
  { environmentId }: Pick<ActionContext, 'environmentId'>,
  type: string,
  id: string,
): Promise<Readonly<Record<string, unknown>>> {
  switch (type) {
    case 'inquiry':
      return (await getInquiry(tx, environmentId, id))?.fields ?? {};
    case 'account':
      return (await getAccount(tx, environmentId, id))?.fields ?? {};
    case 'transaction':
      return (await getTransaction(tx, environmentId, id))?.fields ?? {};
    case 'case':
      return caseFieldValues((await getCaseRow(tx, environmentId, id))?.fields ?? {});
    default:
      return {};
  }
}
