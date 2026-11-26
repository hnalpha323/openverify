'use client';

/**
 * The saved views of one list (C165.1, C165.2, C165.5): apply a view (a plain link to the list's
 * own URL), save the current filters, and, for the owner, rename, share or delete; a view another
 * user shared is copied to be changed. A view whose filters its list no longer accepts, or that
 * this page cannot show, says so and is not applied, so the list is never wider than the view.
 * Saving filters that can name a person is refused in words. Every answer is said in a polite live
 * region.
 */
import type { SavedViewList } from '@openverify/core';
import { Button, Checkbox } from '@openverify/ui';
import Link from 'next/link';
import { useState } from 'react';
import { SAVED_VIEW_COPY as COPY } from './saved-view-words';
import { fillCopy } from '../../lib/copy/analytics';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import type { ActionResult, ActionState } from '../../lib/action-state';

export interface SlotView {
  readonly id: string;
  readonly name: string;
  readonly mine: boolean;
  readonly shared: boolean;
  /** The list URL that applies it, or `null` when it is not applied (see `refusal`). */
  readonly href: string | null;
  readonly refusal: string | null;
  /** The new-export page with this view chosen, for a list that exports. */
  readonly exportHref: string | null;
}

type Action<Data = undefined> = (
  state: ActionState<Data>,
  formData: FormData,
) => Promise<ActionResult<Data>>;

export interface SavedViewsPanelProps {
  readonly list: SavedViewList;
  readonly path: string;
  readonly views: readonly SlotView[];
  /** The current filters as the API names them, JSON, for saving. */
  readonly filters: string;
  readonly notKept: readonly string[];
  /** Filter keys that can name a person: saving is refused while any is set. */
  readonly pii: readonly string[];
  /** Called after a change, so the slot reads the views again. */
  readonly onChange?: () => void;
  readonly actions: {
    readonly create: Action<{ id: string }>;
    readonly update: Action;
    readonly remove: Action;
    readonly copy: Action<{ id: string }>;
  };
}

function Hidden({
  list,
  path,
  id,
}: {
  readonly list: string;
  readonly path: string;
  readonly id?: string;
}) {
  return (
    <>
      <input type="hidden" name="list" value={list} />
      <input type="hidden" name="path" value={path} />
      {id !== undefined && <input type="hidden" name="id" value={id} />}
    </>
  );
}

function ViewItem({
  view,
  list,
  path,
  actions,
  say,
}: {
  readonly view: SlotView;
  readonly list: string;
  readonly path: string;
  readonly actions: SavedViewsPanelProps['actions'];
  readonly say: (words: string) => void;
}) {
  const update = useFormAction(actions.update, {
    onSuccess: () => {
      say(COPY.saved);
    },
  });
  const remove = useFormAction(actions.remove, {
    onSuccess: () => {
      say(COPY.saved);
    },
  });
  const copy = useFormAction(actions.copy, {
    onSuccess: () => {
      say(COPY.copied);
    },
  });
  const tag = view.mine ? (view.shared ? COPY.sharedYours : COPY.yours) : COPY.sharedOther;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-ink">{view.name}</span>
        <span className="text-xs text-ink-muted">({tag})</span>
        {view.href !== null ? (
          <Link href={view.href} className={LINK_CLASS} aria-label={`${COPY.apply} ${view.name}`}>
            {COPY.apply}
          </Link>
        ) : null}
        {view.exportHref !== null && view.href !== null ? (
          <Link
            href={view.exportHref}
            className={LINK_CLASS}
            aria-label={`${COPY.exportView}: ${view.name}`}
          >
            {COPY.exportView}
          </Link>
        ) : null}
      </div>
      {view.refusal !== null && <p className="text-sm text-ink-muted">{view.refusal}</p>}
      {view.mine ? (
        <div className="flex flex-wrap items-end gap-3">
          <form {...update.formProps} className="flex flex-wrap items-end gap-2">
            <Hidden list={list} path={path} id={view.id} />
            <FormField label={`${COPY.rename}: ${view.name}`}>
              {(control) => (
                <input
                  {...control}
                  name="name"
                  defaultValue={view.name}
                  maxLength={100}
                  required
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <Button type="submit" variant="secondary" disabled={update.pending}>
              {COPY.rename}
            </Button>
          </form>
          <form {...update.formProps}>
            <Hidden list={list} path={path} id={view.id} />
            <input type="hidden" name="shared" value={view.shared ? 'false' : 'true'} />
            <Button type="submit" variant="secondary" disabled={update.pending}>
              {view.shared ? COPY.shareOff : COPY.shareOn}
            </Button>
          </form>
          <form {...remove.formProps}>
            <Hidden list={list} path={path} id={view.id} />
            <Button
              type="submit"
              variant="secondary"
              disabled={remove.pending}
              aria-label={`${COPY.delete} ${view.name}`}
            >
              {COPY.delete}
            </Button>
          </form>
        </div>
      ) : (
        <form {...copy.formProps}>
          <Hidden list={list} path={path} id={view.id} />
          <Button
            type="submit"
            variant="secondary"
            disabled={copy.pending}
            aria-label={`${COPY.copy}: ${view.name}`}
          >
            {COPY.copy}
          </Button>
        </form>
      )}
      <ProblemDisplay problem={update.problem ?? remove.problem ?? copy.problem} />
    </li>
  );
}

export function SavedViewsPanel({
  list,
  path,
  views,
  filters,
  notKept,
  pii,
  onChange,
  actions,
}: SavedViewsPanelProps) {
  const [said, setSaid] = useState('');
  const say = (words: string) => {
    setSaid(words);
    onChange?.();
  };
  const create = useFormAction(actions.create, {
    onSuccess: () => {
      say(COPY.saved);
    },
    resetOnSuccess: true,
  });
  const empty = filters === '{}';
  return (
    <section
      aria-labelledby={`saved-views-${list}`}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <h2 id={`saved-views-${list}`} className="text-base font-semibold">
        {COPY.title}
      </h2>
      <p className="text-sm text-ink-muted">{COPY.eachReader}</p>
      {views.length === 0 ? (
        <p className="text-sm text-ink-muted">{COPY.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {views.map((view) => (
            <ViewItem
              key={view.id}
              view={view}
              list={list}
              path={path}
              actions={actions}
              say={say}
            />
          ))}
        </ul>
      )}
      {pii.length > 0 ? (
        <p className="text-sm text-ink">
          <strong>{COPY.piiTitle}.</strong> {fillCopy(COPY.piiDetail, { keys: pii.join(', ') })}
        </p>
      ) : (
        <form {...create.formProps} aria-label={COPY.saveTitle} className="flex flex-col gap-2">
          <Hidden list={list} path={path} />
          <input type="hidden" name="filters" value={filters} />
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={COPY.name}>
              {(control) => (
                <input
                  {...control}
                  name="name"
                  maxLength={100}
                  required
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <Checkbox name="shared" label={COPY.share} />
            <Button type="submit" disabled={create.pending}>
              {COPY.save}
            </Button>
          </div>
          {empty && <p className="text-sm text-ink-muted">{COPY.noFilters}</p>}
          {notKept.length > 0 && (
            <p className="text-sm text-ink-muted">
              {fillCopy(COPY.notKept, { params: notKept.join(', ') })}
            </p>
          )}
          <ProblemDisplay problem={create.problem} />
        </form>
      )}
      <p role="status" className="text-sm">
        {said}
      </p>
    </section>
  );
}
