import type { ThemeSetStatus } from '@openverify/contracts';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { Badge } from '../status-badge';

/** A theme set's status in words (the colour only reinforces it). */
export function ThemeSetStatusBadge({ status }: { readonly status: ThemeSetStatus }) {
  return (
    <Badge
      status={status}
      label={THEMES_COPY.status[status]}
      tone={status === 'active' ? 'success' : 'neutral'}
    />
  );
}

/** The mark of the environment's default set. */
export function DefaultSetBadge() {
  return <Badge status="default" label={THEMES_COPY.list.isDefault} tone="progress" />;
}
