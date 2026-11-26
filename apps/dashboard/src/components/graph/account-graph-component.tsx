import type { AccountGraphComponentResource } from '@openverify/contracts';
import { StageBadge } from '../reports/report-badges';
import { Timestamp } from '../timestamp';

/**
 * The size of the account's graph component (C101.6, K7B-2-console): how many accounts the nightly
 * job linked through strong identifiers, a beta lead that declines or fails nothing, or why there
 * is no size to show.
 */
export function AccountGraphComponent({
  component,
}: {
  readonly component: AccountGraphComponentResource;
}) {
  const { state, size, 'computed-at': computedAt } = component.attributes;
  if (state === 'disabled') {
    return <p className="text-sm text-ink-muted">Components are off</p>;
  }
  if (size === null || computedAt === null) {
    return <p className="text-sm text-ink-muted">Not computed yet</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span>Linked through strong identifiers: {size}</span>
      <StageBadge stage="beta" />
      <span className="text-xs text-ink-muted">
        Computed <Timestamp value={computedAt} /> (UTC)
      </span>
    </p>
  );
}
