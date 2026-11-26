/**
 * C98.2: what every key input of this folder shares: the version of the rules, the shapes, the
 * refusal and the caps.
 */
import type { GraphKeySource, ImportErrorCode, ListKeyKind, ListKind } from '@openverify/core';

/**
 * The version of every key input's rules, including the C78 analysis the name kinds call. A row
 * whose `normaliser_version` differs is not matched: its list answers `normaliser_outdated`
 * (C98.2). Bump it with any change to an output; a golden test fails until then, here and in
 * `packages/watchlist/src/list-keys/`.
 */
export const LIST_KEYS_VERSION = 'lists-1';

/**
 * The longest value of each kind, as the item contract serves it (`packages/contracts/src/lists.ts`,
 * which this package cannot import; `list-keys-golden.test.ts` holds them to its source). The
 * importer reaches the normaliser without that contract, so the caps are checked here too.
 */
export const LIST_VALUE_LIMITS = Object.freeze({
  email: 254,
  idNumber: 100,
  ip: 64,
  name: 300,
  phone: 32,
  fieldValue: 1024,
  string: 255,
});

/** One key of an item or probe: the labelled HMAC is `identifierKey`'s. */
export interface ListKeyInput {
  readonly keyKind: ListKeyKind;
  readonly input: string;
}

/**
 * The keyed labels of the graph kinds (C101.2): the list labels they share, and
 * `identifier-reference-id`, `identifier-name-birthdate`, `identifier-address`,
 * `identifier-postal-code` and `identifier-birthdate`, which only the graph has.
 */
export type GraphKeyKind = Exclude<GraphKeySource, 'existing-index'>;

/** One key of a graph value: the labelled HMAC is `identifierKey`'s. */
export interface GraphKeyInput {
  readonly keyKind: GraphKeyKind;
  readonly input: string;
}

/**
 * A value the normaliser refused; a code, and the wire member it was read from, never the value
 * (C100.4).
 */
export class ListKeyInputError extends Error {
  override name = 'ListKeyInputError';

  constructor(
    readonly code: ImportErrorCode,
    readonly member?: string,
  ) {
    super(code);
  }
}

/** The kinds this folder keys: every kind but names and the two biometric kinds. */
export type KeyedListKind = Exclude<ListKind, 'name' | 'face' | 'selfie-background'>;

/** An item or a probe's members, under their wire names (C97.1, C99.4). */
export type ListValue = Readonly<Record<string, unknown>>;

/** What the list says about its keys (C97.2). */
export interface ListKeyOptions {
  readonly 'case-sensitive'?: boolean;
  readonly 'default-region'?: string | null;
  readonly 'field-key'?: string;
}
