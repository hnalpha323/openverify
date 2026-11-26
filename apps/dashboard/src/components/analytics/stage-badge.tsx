import type { CheckStage } from '@openverify/core';

/** A check's or signal's tier and stage in text, `beta` as an outlined label (ADR 0002 §3c). */
export function TierStage({ tier, stage }: { readonly tier: string; readonly stage: CheckStage }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>
        Tier {tier}, {stage}
      </span>
      {stage !== 'ga' && (
        <span
          data-stage={stage}
          className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink ring-1 ring-control ring-inset"
        >
          {stage === 'beta' ? 'beta' : stage}
        </span>
      )}
    </span>
  );
}
