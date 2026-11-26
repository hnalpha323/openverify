/**
 * Where the case page shows each available case action (C172.5): the `header`, the
 * `status-switcher`, or a layout module (`module:<key>`). An action placed in a module the reader's
 * page does not show is shown in the header instead, so no available action is lost (Workflow 9B
 * CR2: a module placement is not checked against a template's layout).
 */
import type { CaseAvailableActionListDocument } from '@openverify/contracts';
import type { CaseLayoutModule } from '@openverify/core';

export type AvailableAction = CaseAvailableActionListDocument['data'][number];

export interface PlacedActions {
  readonly header: readonly AvailableAction[];
  readonly statusSwitcher: readonly AvailableAction[];
  readonly byModule: ReadonlyMap<CaseLayoutModule, readonly AvailableAction[]>;
}

const MODULE_PREFIX = 'module:';

/** The available actions by where the page shows them, for a page showing `shown`. */
export function placeActions(
  actions: readonly AvailableAction[],
  shown: ReadonlySet<CaseLayoutModule>,
): PlacedActions {
  const header: AvailableAction[] = [];
  const statusSwitcher: AvailableAction[] = [];
  const byModule = new Map<CaseLayoutModule, AvailableAction[]>();
  for (const action of actions) {
    const { placement } = action.attributes;
    if (placement === 'status-switcher') {
      statusSwitcher.push(action);
      continue;
    }
    const module = placement.startsWith(MODULE_PREFIX)
      ? (placement.slice(MODULE_PREFIX.length) as CaseLayoutModule)
      : null;
    if (module !== null && shown.has(module)) {
      byModule.set(module, [...(byModule.get(module) ?? []), action]);
    } else {
      header.push(action);
    }
  }
  return { header, statusSwitcher, byModule };
}
