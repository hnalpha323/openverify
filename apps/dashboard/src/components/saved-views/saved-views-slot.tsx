'use client';

/**
 * The saved-views slot of a list page (C165.1): one line in each list page renders it,
 * `<SavedViewsSlot list="inquiries" />`. In the browser it reads the page's own URL for the current
 * filters and the views of the list from the console's `GET /exports/saved-views?list=` (the list
 * name only, never a filter value), and renders `SavedViewsPanel`. It holds no data on the server,
 * so a list page renders as before, and a failure says so in one line without breaking the list.
 */
import { savedViewPiiFilterKeys } from '@openverify/contracts';
import { transactionStringFieldsFor } from './transaction-field-kinds';
import type { SavedViewList } from '@openverify/core';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { fillCopy } from '../../lib/copy/analytics';
import { listHref } from '../../lib/list-query';
import type { SlotData } from '../../app/exports/saved-views/route';
import {
  copySavedViewAction,
  createSavedViewAction,
  deleteSavedViewAction,
  updateSavedViewAction,
} from './actions';
import { filtersOfParams, paramsOfFilters, savedViewListPath } from './saved-view-lists';
import { SAVED_VIEW_COPY as COPY } from './saved-view-words';
import { SavedViewsPanel, type SlotView } from './saved-views-panel';

export const SAVED_VIEWS_ROUTE = '/exports/saved-views';

export interface SavedViewsSlotProps {
  readonly list: SavedViewList;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | ({ readonly state: 'ready' } & SlotData);

/** The page's URL parameters, repeated ones as lists. */
function paramsOf(search: URLSearchParams | null): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const [name, value] of search ?? []) {
    const known = params[name];
    params[name] =
      known === undefined ? value : [...(typeof known === 'string' ? [known] : known), value];
  }
  return params;
}

export function SavedViewsSlot({ list }: SavedViewsSlotProps) {
  const search = useSearchParams();
  const pathname = usePathname();
  const path = savedViewListPath(list) ?? pathname;
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const reload = useCallback(() => {
    void (async () => {
      try {
        const response = await fetch(`${SAVED_VIEWS_ROUTE}?list=${encodeURIComponent(list)}`, {
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          setLoaded({ state: 'failed' });
          return;
        }
        setLoaded({ state: 'ready', ...((await response.json()) as SlotData) });
      } catch {
        setLoaded({ state: 'failed' });
      }
    })();
  }, [list]);
  useEffect(reload, [reload]);
  if (loaded.state === 'loading') {
    return null;
  }
  if (loaded.state === 'failed') {
    return <p className="text-sm text-ink-muted">{COPY.loadFailed}</p>;
  }
  const current = filtersOfParams(list, paramsOf(search));
  // A filter that can name a person is never put in a form: saving is refused in words.
  const pii = savedViewPiiFilterKeys(
    list,
    current.filters,
    // DA4 (K9-19): a transaction field filter is kept only on a field known not to be a string.
    list === 'transactions'
      ? transactionStringFieldsFor(current.filters, loaded.nonPersonalTransactionFields)
      : {},
  );
  const views: SlotView[] = loaded.views.map((view) => {
    const { params, dropped } = paramsOfFilters(list, view.filters);
    const refusal = !view.filtersValid
      ? fillCopy(COPY.invalid, { keys: view.invalidFilters.join(', ') })
      : dropped.length > 0
        ? fillCopy(COPY.dropped, { keys: dropped.join(', ') })
        : null;
    return {
      id: view.id,
      name: view.name,
      mine: view.mine,
      shared: view.shared,
      href: refusal === null ? listHref(path, params) : null,
      refusal,
      exportHref:
        loaded.exportType === null
          ? null
          : listHref('/exports', { view: view.id, type: loaded.exportType }),
    };
  });
  return (
    <SavedViewsPanel
      list={list}
      path={path}
      views={views}
      filters={pii.length > 0 ? '{}' : JSON.stringify(current.filters)}
      notKept={current.notKept}
      pii={pii}
      onChange={reload}
      actions={{
        create: createSavedViewAction,
        update: updateSavedViewAction,
        remove: deleteSavedViewAction,
        copy: copySavedViewAction,
      }}
    />
  );
}
