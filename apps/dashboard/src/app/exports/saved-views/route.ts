import { savedViewListSchema } from '@openverify/contracts';
import { EXPORT_PERMISSIONS, type ExportObjectType, type SavedViewList } from '@openverify/core';
import { getSession } from '../../../lib/api/me';
import { listSavedViews } from '../../../lib/api/saved-views';
import { getSessionToken } from '../../../lib/session';
import { SAVED_VIEW_READ_PERMISSIONS } from '../../../components/saved-views/saved-view-permissions';
import { readNonPersonalTransactionFields } from '../../../components/saved-views/read-transaction-field-kinds';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;

/** The lists whose rows an export can take from a saved view (C166.1, B19). */
const EXPORT_TYPES: Readonly<Partial<Record<SavedViewList, ExportObjectType>>> = Object.freeze({
  inquiries: 'inquiries',
  accounts: 'accounts',
  reports: 'reports',
  transactions: 'transactions',
});

/** One view as the slot needs it: its filters hold no personal data (the API refuses those). */
export interface SlotViewData {
  readonly id: string;
  readonly name: string;
  readonly mine: boolean;
  readonly shared: boolean;
  readonly filters: Readonly<Record<string, string | readonly string[]>>;
  readonly filtersValid: boolean;
  readonly invalidFilters: readonly string[];
}

export interface SlotData {
  readonly views: readonly SlotViewData[];
  /** The export type of this list when the reader may export it, else `null`. */
  readonly exportType: ExportObjectType | null;
  /**
   * DA4 (K9-19): on the transactions list, the transaction field keys no type declares as a string,
   * so a filter on them holds no personal data; `null` when they cannot all be told; left out on
   * every other list.
   */
  readonly nonPersonalTransactionFields?: readonly string[] | null;
}

/**
 * `GET /exports/saved-views?list=<list>` (C165.1): the saved views a list page's slot shows, read
 * with the operator's session: their own and the environment's shared ones, with whether the reader
 * owns each and whether its list still accepts its filters. It takes the list name only, never the
 * page's filters, so no filter value reaches another URL. Without the list's read permission, 403.
 */
export async function GET(request: Request): Promise<Response> {
  const list = savedViewListSchema.safeParse(new URL(request.url).searchParams.get('list'));
  if (!list.success) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  if ((await getSessionToken()) === null) {
    return new Response(null, { status: 401, headers: NO_STORE });
  }
  try {
    const session = await getSession();
    if (!session.permissions.has(SAVED_VIEW_READ_PERMISSIONS[list.data])) {
      return new Response(null, { status: 403, headers: NO_STORE });
    }
    const views = await listSavedViews(list.data);
    const exportType = EXPORT_TYPES[list.data] ?? null;
    const data: SlotData = {
      views: views.data.map((view) => ({
        id: view.id,
        name: view.attributes.name,
        mine: view.attributes['owner-id'] === session.user.id,
        shared: view.attributes.shared,
        filters: view.attributes.filters,
        filtersValid: view.attributes['filters-valid'],
        invalidFilters: view.attributes['invalid-filters'],
      })),
      exportType:
        exportType !== null && session.permissions.has(EXPORT_PERMISSIONS[exportType])
          ? exportType
          : null,
      ...(list.data === 'transactions'
        ? { nonPersonalTransactionFields: await readNonPersonalTransactionFields() }
        : {}),
    };
    return Response.json(data, { headers: NO_STORE });
  } catch {
    return new Response(null, { status: 502, headers: NO_STORE });
  }
}
