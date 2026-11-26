import type { EnvironmentKind } from '@openverify/contracts';
import { cx } from '@openverify/ui';

const BANNERS: Record<EnvironmentKind, { label: string; note: string; className: string }> = {
  sandbox: {
    label: 'Sandbox',
    note: 'Test data only. Nothing here reaches production.',
    className: 'border-amber-300 bg-amber-100 text-amber-950',
  },
  production: {
    label: 'Production',
    note: 'Live data.',
    className: 'border-line bg-surface text-ink',
  },
};

/**
 * Names the session's environment on every console page (C21): amber for the sandbox, a neutral
 * bar for production. A status region, so a switch is announced.
 */
export function EnvironmentBanner({ kind }: { readonly kind: EnvironmentKind }) {
  const banner = BANNERS[kind];
  return (
    <div
      role="status"
      aria-label="Environment"
      data-environment={kind}
      className={cx('border-b px-6 py-1.5 text-sm', banner.className)}
    >
      <p className="mx-auto flex max-w-6xl flex-wrap gap-x-2">
        <strong className="font-semibold">{banner.label}</strong>
        <span>{banner.note}</span>
      </p>
    </div>
  );
}
