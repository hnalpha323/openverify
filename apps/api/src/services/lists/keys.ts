/**
 * C98.2 (Workflow 7B): an item's stored keys and side rows, and a probe's keys, from the key inputs
 * of `packages/checks/src/lists/` and `packages/watchlist/src/list-keys/` under `identifierKey`. The
 * first key of an item is its `match_key` and the rest go to `list_item_keys`; a range keeps its
 * plaintext `cidr` row, a country its plaintext column and a geolocation its coarse box. One place
 * builds them, for the item routes, the importer's writer, the graph's add-to-list and the rebuild.
 */
import {
  LIST_KEYS_VERSION,
  listKeyInputs,
  listProbeKeyInputs,
  type KeyedListKind,
  type ListKeyInput,
  type ListKeyOptions,
  type ListValue,
} from '@openverify/checks';
import { LIST_KIND_REGISTRY, type ListKeyKind, type ListKind } from '@openverify/core';
import { blindIndexKeyId, identifierKey, type ListRow, type NewListItem } from '@openverify/db';
import {
  listLastNameKeyInputs,
  listNameKeyInputs,
  type ListName,
} from '@openverify/watchlist';
import { geoBoxes } from './geo.js';

/** What a key reads of its list (C97.2). */
export type ListKeySource = Pick<
  ListRow,
  'type' | 'fieldKey' | 'caseSensitive' | 'defaultRegion' | 'allowFuzzyNameFirst'
>;

/** C97.2: the list's members that change a key. */
export function keyOptionsOf(list: ListKeySource): ListKeyOptions {
  return {
    'case-sensitive': list.caseSensitive,
    'default-region': list.defaultRegion,
    ...(list.fieldKey === null ? {} : { 'field-key': list.fieldKey }),
  };
}

/**
 * C98.2: the key inputs of a stored item: the exact keys, then, on a fuzzy names list, the
 * last-name candidates.
 * @throws {ListKeyInputError} for a value its kind refuses.
 */
export function itemKeyInputs(list: ListKeySource, value: ListValue): ListKeyInput[] {
  if (list.type === 'name') {
    const name = value as unknown as ListName;
    return [
      ...listNameKeyInputs(name),
      ...(list.allowFuzzyNameFirst ? listLastNameKeyInputs(name) : []),
    ];
  }
  return listKeyInputs(list.type as KeyedListKind, value, keyOptionsOf(list));
}

/**
 * C98.2: the keys a probe sends to a list, per list, because a phone's national form needs its
 * region and a string its case rule.
 * @throws {ListKeyInputError} for a value its kind refuses.
 */
export function probeKeyInputs(list: ListKeySource, value: ListValue): ListKeyInput[] {
  return list.type === 'name'
    ? listNameKeyInputs(value as unknown as ListName)
    : listProbeKeyInputs(list.type as KeyedListKind, value, keyOptionsOf(list));
}

/** One labelled HMAC under the environment subkey. */
export function hashedKey(key: Uint8Array, environmentId: string, input: ListKeyInput): string {
  return identifierKey(key, { environmentId, kind: input.keyKind, input: input.input });
}

/** What an item's keys and side rows are, with its `normaliser_version`. */
export interface StoredKeys {
  matchKey: string;
  keys: { keyKind: ListKeyKind; matchKey: string }[];
  normaliserVersion: string;
  keyId: string | null;
  countryCode: string | null;
  range: string | null;
  boxes: string[];
}

/**
 * C98.1, C98.2: what the list stores for one item beside its sealed value.
 * @throws {ListKeyInputError} for a value its kind refuses.
 */
export function storedKeysOf(
  key: Uint8Array,
  environmentId: string,
  list: ListKeySource,
  value: ListValue,
): StoredKeys {
  const inputs = itemKeyInputs(list, value);
  const [first, ...rest] = inputs;
  if (first === undefined) {
    throw new TypeError('A stored item has at least one key');
  }
  const kind: ListKind = list.type;
  return {
    matchKey: hashedKey(key, environmentId, first),
    keys: rest.map((input) => ({
      keyKind: input.keyKind,
      matchKey: hashedKey(key, environmentId, input),
    })),
    normaliserVersion: LIST_KEYS_VERSION,
    keyId: LIST_KIND_REGISTRY[kind].keyed ? blindIndexKeyId(key) : null,
    countryCode: kind === 'country' ? first.input : null,
    range: first.keyKind === 'identifier-ip-range' ? first.input : null,
    boxes:
      kind === 'geolocation'
        ? geoBoxes(
            Number(value.latitude),
            Number(value.longitude),
            Number(value['radius-meters']),
          )
        : [],
  };
}

/** The sealed value and keys of a new item. */
export function newListItem(
  key: Uint8Array,
  environmentId: string,
  list: ListKeySource,
  input: { id: string; value: ListValue; creator: NonNullable<NewListItem['creator']> },
): NewListItem {
  return { ...input, ...storedKeysOf(key, environmentId, list, input.value) };
}
