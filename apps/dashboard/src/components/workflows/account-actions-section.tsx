/**
 * The account page's workflow actions slot (C118.7, C141.7; Workflow 8C, F32): the account actions
 * the principal may run (`GET /accounts/:id/available-actions`, `workflows:trigger` and
 * `accounts:read`, filtered by the caller's grant), each with its parameter form prefilled under
 * the viewer's mask.
 *
 * The account page calls it as a function and awaits it through `loadSection`, only for a
 * principal holding `workflows:trigger`: a thrown 403 gives the section's forbidden panel, and
 * `null` leaves the section out.
 */
import type { Permission } from '@openverify/core';
import type { ReactNode } from 'react';
import { runAccountAction } from '../../app/workflows/actions';
import { getApiClient } from '../../lib/api/client';
import { AccountActions } from './account-actions';

export interface AccountActionsSectionProps {
  /** The account, `acc_…`. */
  readonly accountId: string;
  /** The principal's permissions, as `GET /dashboard/me` answered them. */
  readonly permissions: ReadonlySet<Permission>;
}

/** The section's content, or `null` for none. */
export const AccountActionsSection: (
  props: AccountActionsSectionProps,
) => Promise<ReactNode> = async ({ accountId }) => {
  const api = await getApiClient();
  const { data } = await api.accountActions.available(accountId);
  if (data.length === 0) {
    return null;
  }
  return (
    <AccountActions
      accountId={accountId}
      items={data.map((action) => ({
        id: action.id,
        label: action.attributes.label,
        workflowId: action.relationships.workflow.data.id,
        form: action.attributes.form,
      }))}
      run={runAccountAction}
    />
  );
};
