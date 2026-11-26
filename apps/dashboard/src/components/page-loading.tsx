import { PageMain } from './page-main';

/**
 * A page's loading state (`loading.tsx`): announced politely, with a placeholder layout that
 * screen readers skip.
 */
export function PageLoading({ label = 'Loading…' }: { readonly label?: string }) {
  return (
    <PageMain>
      <div role="status" className="flex flex-col gap-4">
        <span className="text-sm text-ink-muted">{label}</span>
        <div aria-hidden="true" className="flex animate-pulse flex-col gap-3">
          <div className="h-8 w-1/3 rounded bg-line" />
          <div className="h-4 w-2/3 rounded bg-line" />
          <div className="h-40 w-full rounded-xl bg-line" />
        </div>
      </div>
    </PageMain>
  );
}
