/**
 * C106.2 (Workflow 7B): what the report engine reads of a custom-list report beyond the job. Owner:
 * `api-lists`. `services/reports/resources.ts` serves live matches through
 * {@link customListMatchedLists}, because a custom-list match groups by list under `items` and keeps
 * its own evidence rather than the row's score; the report and template rules read
 * {@link customListListProblems}.
 */
import type { ListProblemCode } from '@openverify/contracts';
import { getLists, type Db, type StoredReportMatch } from '@openverify/db';

type Member = Readonly<Record<string, unknown>>;

/** One list a run matched, as the resource serves it. */
export interface CustomListMatchedList {
  'list-id': string;
  'list-type': string;
  name: string;
  version: number;
  items: (Member & { 'match-id': string })[];
}

/** C106.2: the matches grouped by the list they were found on; a redacted snapshot is left out. */
export function customListMatchedLists(
  matches: readonly StoredReportMatch[],
): CustomListMatchedList[] {
  const lists = new Map<string, CustomListMatchedList>();
  for (const match of matches) {
    const { snapshot } = match;
    if (snapshot !== null) {
      const list = snapshot.list as Omit<CustomListMatchedList, 'items'>;
      const entry = lists.get(list['list-id']) ?? { ...list, items: [] };
      entry.items.push({ ...(snapshot.entity as Member), 'match-id': match.id });
      lists.set(list['list-id'], entry);
    }
  }
  return [...lists.values()];
}

export interface CustomListProblem {
  code: ListProblemCode;
  detail: string;
  /** A JSON pointer into the request body. */
  pointer: string;
}

/**
 * C106.2: a report needs a list, from its query or pinned on its template (422
 * `report_lists_required`), and a pinned list must be live (422 `report_list_unavailable`).
 */
export async function customListListProblems(
  db: Db,
  environmentId: string,
  lists: { pinned?: readonly string[] | null | undefined; asked?: readonly string[] | undefined },
): Promise<CustomListProblem[]> {
  const { pinned, asked } = lists;
  if (pinned == null) {
    return asked === undefined
      ? [
          {
            code: 'report_lists_required',
            detail: 'Give `list-ids` on the query, or pin them on the report template.',
            pointer: '/data/attributes/query/list-ids',
          },
        ]
      : [];
  }
  const live = new Set(
    (await getLists(db, environmentId, pinned))
      .filter(({ status }) => status === 'active')
      .map(({ id }) => id),
  );
  return pinned.flatMap((id, index) =>
    live.has(id)
      ? []
      : [
          {
            code: 'report_list_unavailable' as const,
            detail: `List ${id} is archived or gone.`,
            pointer: `/data/attributes/config/list-ids/${String(index)}`,
          },
        ],
  );
}
