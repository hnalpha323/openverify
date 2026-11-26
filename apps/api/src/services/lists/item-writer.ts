/**
 * C99.1 (Workflow 7B; F08): the `ListItemWriter` and `ListService` of the worker and the API, the
 * one way items reach a list besides the item route: the importer writes through the first, and the
 * graph's add-to-list through the second. Owner: `api-lists`. `foundation-7b` froze the ports
 * (`ports.ts`), with in-memory fakes in `test-support/fakes.ts`.
 *
 * Both key through `keys.ts`, so every path stores the same keys and `normaliser_version`. A value
 * the normaliser refuses is a code and a position, never thrown and never echoed (C100.4), so
 * `all-or-nothing` and `skip-invalid` read one answer.
 *
 * `unbuiltListItemWriter` and `unbuiltListService` stay until the worker and the container build
 * the real ones (`createListItemWriter`, `createListService`).
 */
import { ListKeyInputError, type ListValue } from '@openverify/checks';
import { newId, type IdPrefix } from '@openverify/contracts';
import { LIST_KIND_REGISTRY, type ImportErrorCode, type ListKind } from '@openverify/core';
import {
  getLiveListItemByKey,
  insertListItems,
  type Db,
  type ListRow,
  type NewListItem,
} from '@openverify/db';
import { stageListUpdated } from '../../workflows/actions/lists/list-updated.js';
import { ListProblemError, NotImplementedError } from '../../errors.js';
import type { TransactionalEventPublisher } from '../../events/index.js';
import type { ListItemWriter, ListService, RateLimiter } from '../../ports.js';
import { itemLimitOf, lockWritableList } from './items.js';
import { newListItem, storedKeysOf } from './keys.js';
import { requireList } from './lists.js';
import { consumeListWrite } from './rate.js';

export const unbuiltListItemWriter: ListItemWriter = {
  insertItems: () => Promise.reject(new NotImplementedError('ListItemWriter is not built yet.')),
};

export const unbuiltListService: ListService = {
  createItem: () => Promise.reject(new NotImplementedError('ListService is not built yet.')),
  createItemInTx: () => Promise.reject(new NotImplementedError('ListService is not built yet.')),
};

/** What a stored value holds beyond what was entered: an email's default match type. */
export const itemValueOf = (kind: ListKind, attributes: ListValue): ListValue =>
  kind === 'email-address' ? { 'match-type': 'email_address', ...attributes } : attributes;

const newItemId = (kind: ListKind) => newId(LIST_KIND_REGISTRY[kind].itemPrefix as IdPrefix);

function assertKeyed(list: ListRow): void {
  if (LIST_KIND_REGISTRY[list.type].biometric) {
    throw new ListProblemError(
      'list_kind_mismatch',
      'A face or background item is added from an inquiry.',
    );
  }
}

/**
 * C99.1, C100.2: writes `items` in `tx`, under the list's row lock, in one go. Rows past the
 * list's limit are refused with `row_limit_exceeded`.
 * @throws {NotFoundError} for a list the environment does not hold.
 * @throws {ListProblemError} for an archived or biometric list.
 */
export function createListItemWriter(deps: { blindIndexKey: Uint8Array }): ListItemWriter {
  return {
    async insertItems(tx, { environmentId, listId, items }) {
      const list = await lockAnyWritableList(tx, environmentId, listId);
      assertKeyed(list);
      const room = itemLimitOf(list) - list.itemCount;
      const rows: NewListItem[] = [];
      const refused: { index: number; code: ImportErrorCode }[] = [];
      items.forEach((item, index) => {
        try {
          const row = newListItem(deps.blindIndexKey, environmentId, list, {
            id: newItemId(list.type),
            value: itemValueOf(list.type, item.attributes),
            creator: item.creator,
          });
          if (rows.length >= room) {
            refused.push({ index, code: 'row_limit_exceeded' });
          } else {
            rows.push(row);
          }
        } catch (error) {
          if (!(error instanceof ListKeyInputError)) {
            throw error;
          }
          refused.push({ index, code: error.code });
        }
      });
      const { inserted, alreadyPresent } = await insertListItems(tx, environmentId, listId, rows);
      return { inserted, alreadyPresent, refused };
    },
  };
}

/** The list, locked and active, of whatever kind it is. */
async function lockAnyWritableList(tx: Db, environmentId: string, listId: string) {
  const list = await requireList(tx, environmentId, listId);
  return lockWritableList(tx, environmentId, listId, list.type);
}

/**
 * C99.1, C103: one item through the list's rules. A value already live answers its item.
 * @throws {ListProblemError} with the normaliser's code, 409 `list_limit_reached`, or the list's
 * refusals.
 */
export function createListService(deps: {
  db: Db;
  blindIndexKey: Uint8Array;
  rateLimiter: RateLimiter;
  events: TransactionalEventPublisher;
}): ListService {
  const writer = createListItemWriter(deps);

  /** The item in the caller's transaction: no rate token, and `list.updated` is the caller's. */
  const createItemInTx: ListService['createItemInTx'] = async (
    tx,
    { environmentId, listId, item },
  ) => {
    const result = await writer.insertItems(tx, { environmentId, listId, items: [item] });
    const [refused] = result.refused;
    if (refused !== undefined) {
      throw problemOf(refused.code);
    }
    const [written] = result.inserted;
    if (written !== undefined) {
      return { id: written.id, alreadyPresent: false };
    }
    const list = await requireList(tx, environmentId, listId);
    const { matchKey } = storedKeysOf(
      deps.blindIndexKey,
      environmentId,
      list,
      itemValueOf(list.type, item.attributes),
    );
    const id = await getLiveListItemByKey(tx, environmentId, listId, matchKey);
    if (id === null) {
      throw new Error('A value already present has a live item');
    }
    return { id, alreadyPresent: true };
  };

  return {
    createItemInTx,
    async createItem(input) {
      const { environmentId, listId } = input;
      await consumeListWrite(deps, environmentId);
      const { created, staged } = await deps.db.transaction(async (tx) => {
        const answer = await createItemInTx(tx, input);
        return {
          created: answer,
          staged: answer.alreadyPresent
            ? []
            : await stageListUpdated(tx, deps, environmentId, [
                { listId, changeKind: 'items-added', items: 1 },
              ]),
        };
      });
      await deps.events.dispatch(staged);
      return created;
    },
  };
}

function problemOf(code: ImportErrorCode): ListProblemError {
  return code === 'row_limit_exceeded'
    ? new ListProblemError('list_limit_reached', 'This list holds as many items as it may.')
    : new ListProblemError(
        code as ConstructorParameters<typeof ListProblemError>[0],
        `The value was refused: ${code}.`,
      );
}
