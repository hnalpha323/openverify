/**
 * The case checklists as the case page shows them (C172.2, C172.7): the pinned version's checklists
 * beside the state `GET /cases/:id/checklist` answered, item by item. Pure, so the page and the
 * status switcher read the same answer.
 */
import type { CaseChecklistStateDocument, CaseChecklists } from '@openverify/contracts';

type ItemState = CaseChecklistStateDocument['data']['attributes']['items'][number];

/** One item of a checklist with its state: who checked it and when, or nobody. */
export interface ChecklistItemView {
  readonly checklistKey: string;
  readonly itemKey: string;
  readonly label: string;
  /** The status keys this item must be checked before. */
  readonly requiredFor: readonly string[];
  readonly checked: boolean;
  readonly checkedBy: string | null;
  readonly checkedAt: string | null;
}

export interface ChecklistView {
  readonly key: string;
  readonly label: string;
  readonly items: readonly ChecklistItemView[];
}

const stateKey = (checklist: string, item: string) => `${checklist}\u0000${item}`;

/**
 * The version's checklists with each item's state from `items`. An item the state does not name
 * reads as unchecked by nobody: nothing is ever shown as checked that the API did not say was.
 */
export function checklistViews(
  checklists: CaseChecklists,
  items: readonly ItemState[],
): ChecklistView[] {
  const states = new Map(
    items.map((item) => [stateKey(item['checklist-key'], item['item-key']), item]),
  );
  return checklists.map((checklist) => ({
    key: checklist.key,
    label: checklist.label,
    items: checklist.items.map((item) => {
      const state = states.get(stateKey(checklist.key, item.key));
      const checkedState = state?.checked === true ? state : undefined;
      return {
        checklistKey: checklist.key,
        itemKey: item.key,
        label: item.label,
        requiredFor: item['required-for-statuses'],
        checked: checkedState !== undefined,
        checkedBy: checkedState?.['checked-by'] ?? null,
        checkedAt: checkedState?.['checked-at'] ?? null,
      };
    }),
  }));
}

/** The unchecked items that refuse entry into `status` (422 `case_checklist_incomplete`). */
export function itemsBlocking(
  views: readonly ChecklistView[],
  status: string,
): ChecklistItemView[] {
  return views.flatMap((view) =>
    view.items.filter((item) => !item.checked && item.requiredFor.includes(status)),
  );
}
