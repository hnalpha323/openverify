/**
 * The lists a picker offers (C99.5's `list-config.screen`, C106.2's custom-list `list-ids`): the
 * environment's active lists, read page after page up to the active-list cap (C97.5,
 * `LIST_LIMITS.activeListsPerEnvironment`), so none is left out of the picker. Server code: the
 * pages call it with their request's API client and pass the choices to the forms.
 */
import type { ListResource } from '@openverify/contracts';
import { LIST_LIMITS } from '@openverify/core';
import type { OpenVerifyClient } from '@openverify/node';
import type { ListChoice } from './member-form';

/** C97.5: an environment holds at most this many active lists. */
export const LIST_CHOICES_MAX = LIST_LIMITS.activeListsPerEnvironment;

const choiceOf = (list: ListResource): ListChoice => ({
  id: list.id,
  name: list.attributes.name,
  kind: list.type.slice('list/'.length),
});

export async function readListChoices(api: OpenVerifyClient): Promise<ListChoice[]> {
  const choices: ListChoice[] = [];
  for await (const list of api.lists.listAll({
    filter: { status: 'active' },
    page: { size: 100 },
  })) {
    choices.push(choiceOf(list));
    if (choices.length === LIST_CHOICES_MAX) {
      break;
    }
  }
  return choices;
}
