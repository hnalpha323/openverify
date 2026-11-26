/**
 * Row-bound encryption for the columns schema v2 adds (carried-over finding F004).
 *
 * Phase 1 columns (`encrypted()`, `encryptedJson()`) bind their ciphertext to a static
 * context such as `inquiries.fields`: a value cannot move to another column, but it can
 * move to another row of the same column. Schema v2 columns bind it to the column *and*
 * the row id, like `encryptBytes` binds a file object to its file id: the AAD context is
 * `<table>.<column>#<row id>`.
 *
 * A Drizzle column type only sees the value, never the row, so these columns are plain
 * `text` typed {@link Sealed}. Repositories seal on write and open on read with the row id
 * they already hold, and return plaintext to their callers. A row id that differs from the
 * one used to seal (a swapped or copied ciphertext) fails authentication.
 */
import { text } from 'drizzle-orm/pg-core';
import { decrypt, encrypt, getDefaultKeyring, type Keyring } from './crypto.js';

declare const sealedBrand: unique symbol;

/** Ciphertext of a value sealed for one column and row; open it with {@link openValue}. */
export type Sealed = string & { readonly [sealedBrand]: true };

/** A `text` column holding {@link Sealed} values. */
export const sealedColumn = (name: string) => text(name).$type<Sealed>();

/** The AAD context of a row-bound value. */
export const rowContext = (column: string, rowId: string): string => `${column}#${rowId}`;

/** Seals a UTF-8 string for `column` (`table.column`) of the row `rowId`. */
export function sealValue(
  column: string,
  rowId: string,
  plaintext: string,
  keyring: Keyring = getDefaultKeyring(),
): Sealed {
  return encrypt(plaintext, keyring, { context: rowContext(column, rowId) }) as Sealed;
}

/** Opens a value sealed by {@link sealValue} for the same column and row. */
export function openValue(
  column: string,
  rowId: string,
  sealed: Sealed,
  keyring: Keyring = getDefaultKeyring(),
): string {
  return decrypt(sealed, keyring, { context: rowContext(column, rowId) });
}

/** Seals a JSON value (serialised with `JSON.stringify`). */
export function sealJson(
  column: string,
  rowId: string,
  value: unknown,
  keyring: Keyring = getDefaultKeyring(),
): Sealed {
  return sealValue(column, rowId, JSON.stringify(value), keyring);
}

/** Opens a JSON value sealed by {@link sealJson}; the caller narrows its type. */
export function openJson(
  column: string,
  rowId: string,
  sealed: Sealed,
  keyring: Keyring = getDefaultKeyring(),
): unknown {
  return JSON.parse(openValue(column, rowId, sealed, keyring));
}

/** {@link sealValue} for an optional value: `null` stays `null`. */
export const sealOptional = (
  column: string,
  rowId: string,
  plaintext: string | null | undefined,
): Sealed | null => (plaintext == null ? null : sealValue(column, rowId, plaintext));

/** {@link openValue} for an optional value: `null` stays `null`. */
export const openOptional = (
  column: string,
  rowId: string,
  sealed: Sealed | null,
): string | null => (sealed === null ? null : openValue(column, rowId, sealed));

/** {@link sealJson} for an optional value: `null` and `undefined` become `null`. */
export const sealOptionalJson = (column: string, rowId: string, value: unknown): Sealed | null =>
  value == null ? null : sealJson(column, rowId, value);

/** {@link openJson} for an optional value: `null` stays `null`. */
export const openOptionalJson = (column: string, rowId: string, sealed: Sealed | null): unknown =>
  sealed === null ? null : openJson(column, rowId, sealed);
