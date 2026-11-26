'use server';

/**
 * The audit explorer's address search (C168.6; `audit-logs:read` and `pii:view`): one exact IPv4
 * or IPv6 address, matched by the API through its IP index. Posted, never in a URL or a saved view,
 * because an address is personal data (rule 11).
 */
import type { UserAuditLogResource } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { isIP } from 'node:net';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ActionInputError, formString, runAction } from '../../lib/api/action';
import { listAuditLogs } from '../../lib/api/audit-logs';
import { SETTINGS_COPY } from '../../lib/copy/settings';

export interface AuditIpResult {
  readonly entries: readonly UserAuditLogResource[];
  /** More entries came from the address than the one page answered. */
  readonly more: boolean;
}

const COPY = SETTINGS_COPY.audit;

export async function searchAuditLogsByIp(
  _previous: ActionState<AuditIpResult>,
  formData: FormData,
): Promise<ActionResult<AuditIpResult>> {
  return runAction({ permissions: ['audit-logs:read', 'pii:view'] }, async () => {
    const ip = formString(formData, 'ip')?.trim() ?? '';
    if (isIP(ip) === 0) {
      throw new ActionInputError({
        title: 'Check the address',
        errors: [{ pointer: '/ip', detail: COPY.ipInvalid }],
      });
    }
    try {
      const page = await listAuditLogs({ ip });
      return { entries: page.data, more: page.links.next !== null };
    } catch (error) {
      if (error instanceof OpenVerifyApiError && error.status === 503) {
        throw new ActionInputError({ title: COPY.ipUnavailable, status: 503 });
      }
      throw error;
    }
  });
}
