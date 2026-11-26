/**
 * C98.2, C100.3, C100.4: one CSV row as an item and its dedup key, by the one rule a create body
 * meets. Owner: `api-importers`.
 */
import {
  importColumnOf,
  importRowItem,
  listKeyInputs,
  ListKeyInputError,
  type KeyedListKind,
  type ListKeyInput,
  type ListKeyOptions,
  type ListValue,
} from '@openverify/checks';
import type { ImportList } from '@openverify/db';
import { listNameKeyInputs, type ListName } from '@openverify/watchlist';
import type { ImportFileError, ImportFileRow } from './read-file.js';

export type ReadImportRow = { attributes: ListValue; matchKey: string } | { error: ImportFileError };

const optionsOf = (list: ImportList): ListKeyOptions => ({
  'case-sensitive': list.caseSensitive,
  'default-region': list.defaultRegion,
  ...(list.fieldKey === null ? {} : { 'field-key': list.fieldKey }),
});

function keyInputsOf(list: ImportList, item: ListValue): ListKeyInput[] {
  return list.kind === 'name'
    ? listNameKeyInputs(item as unknown as ListName)
    : listKeyInputs(list.kind as KeyedListKind, item, optionsOf(list));
}

/**
 * The row's item and the key `list_items.match_key` will hold, or its error. A value that breaks a
 * normaliser in a way it did not plan for is still that value's fault, and answers `invalid_value`
 * rather than failing the import for every other row.
 */
export function readImportRow(
  list: ImportList,
  { row, cells }: ImportFileRow,
  keyOf: (kind: ListKeyInput['keyKind'], input: string) => string,
): ReadImportRow {
  try {
    const attributes = importRowItem(list.kind, cells);
    const [key] = keyInputsOf(list, attributes);
    if (key === undefined) {
      return { error: { row, column: null, code: 'invalid_value' } };
    }
    return { attributes, matchKey: keyOf(key.keyKind, key.input) };
  } catch (error) {
    if (error instanceof ListKeyInputError) {
      const column = error.member === undefined ? null : importColumnOf(list.kind, error.member);
      return { error: { row, column, code: error.code } };
    }
    return { error: { row, column: null, code: 'invalid_value' } };
  }
}
