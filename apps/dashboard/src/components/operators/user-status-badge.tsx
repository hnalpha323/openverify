import type { UserStatus } from '@openverify/contracts';
import { Badge, type BadgeTone } from '../status-badge';

export const USER_STATUS_LABELS: Readonly<Record<UserStatus, string>> = Object.freeze({
  invited: 'Invited',
  active: 'Active',
  deactivated: 'Deactivated',
});

const TONES: Record<UserStatus, BadgeTone> = {
  invited: 'progress',
  active: 'success',
  deactivated: 'neutral',
};

/** An operator's status: invited (not accepted yet), active, or deactivated. */
export function UserStatusBadge({ status }: { readonly status: UserStatus }) {
  return <Badge status={status} label={USER_STATUS_LABELS[status]} tone={TONES[status]} />;
}
