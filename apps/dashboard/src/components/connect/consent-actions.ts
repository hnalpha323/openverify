'use server';

/**
 * The console's withdrawal of a consent record (C237.1, C242.3): `withdrawn-via: operator`, with an
 * optional reason from the closed list. Its effects (a created token expires, a running redemption
 * fails, the counterparty is told about a redeemed one) are the API's, in one transaction.
 */
import {
  CONSENT_WITHDRAWAL_REASONS,
  idSchema,
  type ConsentWithdrawalReason,
} from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { revalidatePath } from 'next/cache';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, runAction } from '../../lib/api/action';
import { displayProblemOf } from '../../lib/api/errors';
import { withdrawConsentRecord } from './connect-api';
import { describeConnectProblem } from './connect-problem-words';

function refuse(pointer: string, detail: string): never {
  throw new ActionInputError({
    title: 'Check the values you entered',
    detail: 'Some values are not valid.',
    errors: [{ pointer, detail }],
  });
}

/** The console page of a record's subject, by its id's prefix. */
const SUBJECT_PATHS: Readonly<Record<string, string>> = {
  inq: '/inquiries',
  acc: '/accounts',
  txn: '/transactions',
};

export async function withdrawConsentRecordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionResult> {
  return runAction({ permissions: ['connect-share-tokens:write'] }, async () => {
    const id = idSchema('cnsr').safeParse(formString(formData, 'consent-record-id'));
    if (!id.success) {
      refuse('/consent-record-id', 'This is not a consent record id.');
    }
    const posted = formString(formData, 'withdrawal-reason') ?? '';
    if (posted !== '' && !(CONSENT_WITHDRAWAL_REASONS as readonly string[]).includes(posted)) {
      refuse('/withdrawal-reason', 'Choose one of the reasons, or none.');
    }
    const reason = posted === '' ? undefined : (posted as ConsentWithdrawalReason);
    let record;
    try {
      record = await withdrawConsentRecord(id.data, reason);
    } catch (error) {
      if (error instanceof OpenVerifyApiError && error.status !== 401) {
        throw new ActionInputError(
          describeConnectProblem(displayProblemOf(error, { apiForbidden: 'detail' })),
        );
      }
      throw error;
    }
    const subject = record.relationships.subject.data?.id;
    const base =
      subject === undefined ? undefined : SUBJECT_PATHS[subject.slice(0, subject.indexOf('_'))];
    if (subject !== undefined && base !== undefined) {
      revalidatePath(`${base}/${subject}`);
    }
    return undefined;
  });
}
