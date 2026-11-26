'use client';

import { OneTimeSecretDialog } from './one-time-secret-dialog';

/** Recovery codes, shown once (C15); the owner drops them in `onClose`. */
export function RecoveryCodesDialog({
  codes,
  onClose,
}: {
  readonly codes: readonly string[] | null;
  readonly onClose: () => void;
}) {
  return (
    <OneTimeSecretDialog
      open={codes !== null}
      title="Save your recovery codes"
      label="Recovery codes"
      secret={codes ?? []}
      onClose={onClose}
      description="Each code signs you in once when your second factor is not at hand. This is the only time they are shown: save them somewhere safe."
    />
  );
}
