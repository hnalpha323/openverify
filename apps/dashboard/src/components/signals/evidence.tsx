/**
 * The evidence parts of a signal, a network fact or a list match (ADR 0002, ADR 0006): its tier
 * as text, the `beta` badge of a heuristic, its confidence and its reasons in words. Nothing here
 * passes, fails or declines anything.
 */
import type { ReactNode } from 'react';
import { StageBadge } from '../reports/report-badges';

/** An evidence tier (R, H, A, or a combined one) as text, never by colour alone. */
export function TierBadge({ tier }: { readonly tier: string }) {
  return (
    <span
      data-tier={tier}
      className="inline-flex items-center rounded-md bg-canvas px-1.5 py-0.5 font-mono text-xs font-semibold text-ink ring-1 ring-line ring-inset"
    >
      <span className="sr-only">Tier </span>
      {tier}
    </span>
  );
}

/** The tier, with the `beta` badge of a heuristic and its confidence when it has one. */
export function EvidenceMeta({
  tier,
  beta,
  confidence,
}: {
  readonly tier: string;
  readonly beta: boolean;
  readonly confidence?: number | null | undefined;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <TierBadge tier={tier} />
      {beta && <StageBadge stage="beta" />}
      {confidence !== undefined && confidence !== null && (
        <span className="text-xs text-ink-muted">confidence {confidence.toFixed(2)}</span>
      )}
    </span>
  );
}

/** Reasons in words, joined; nothing when there are none. */
export function ReasonList({ reasons }: { readonly reasons: readonly string[] }): ReactNode {
  if (reasons.length === 0) {
    return null;
  }
  return <span className="block text-xs text-ink-muted">{reasons.join('; ')}</span>;
}
