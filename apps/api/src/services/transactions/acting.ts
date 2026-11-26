/** What every Workflow 7B transaction service takes. */
import type { Permission } from '@openverify/core';
import type { Acting } from '../inquiries.js';

export type TransactionActing = Pick<Acting, 'ctx' | 'mask' | 'actor'> & {
  /**
   * Whether the principal holds a permission beyond the route's own: a `platform-file` value needs
   * `verifications:read` (C104.2, P12). Absent, as for a call made by the platform itself, it holds
   * none, so such a value is refused rather than written unchecked.
   */
  allows?: ((permission: Permission) => boolean) | undefined;
};
