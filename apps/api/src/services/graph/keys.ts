/**
 * C101.2 (Workflow 7B): the value keys of the graph kinds. Every value is keyed under its kind's
 * identifier label with `identifierKey` (F10), from the key inputs of `packages/checks/src/lists`
 * and `packages/watchlist/src/list-keys` (decision 29, narrowed: a list hit and a graph link meet on
 * one key); `government_id_number`, `chip_signature` and `crypto_address` keep their existing
 * indexes, which their owners compute. A value a kind refuses has no key, and nothing is written for
 * it: no key is ever a guess. Nothing here logs; a value reaches an HMAC only.
 *
 * Also the blind-index key the in-transaction indexer uses: its frozen signature carries none, so
 * it reads `OPENVERIFY_BLIND_INDEX_KEY`, the variable every process's configuration requires, unless
 * a process or a test gives one with {@link useGraphIndexKey}.
 */
import { graphKeyInput, ListKeyInputError, type GraphKeyInput } from '@openverify/checks';
import type { GraphKind } from '@openverify/core';
import { blindIndexKeyFromEnv, blindIndexKeyId, identifierKey } from '@openverify/db';
import { graphNameBirthdateKeyInputs, graphNameKeyInputs } from '@openverify/watchlist';

let configuredKey: Uint8Array | null | undefined;

/** Gives the indexer its key (`undefined` reads the environment again). */
export function useGraphIndexKey(key: Uint8Array | undefined): void {
  configuredKey = key;
}

/** The key the in-transaction indexer uses, or `null` when the process has none. */
export function graphIndexKey(): Uint8Array | null {
  if (configuredKey === undefined) {
    try {
      configuredKey = blindIndexKeyFromEnv(process.env);
    } catch {
      configuredKey = null;
    }
  }
  return configuredKey;
}

/** A plaintext value of a kind: a text, or the members of a list item (`name-first`, ...). */
export type GraphPlainValue = string | Readonly<Record<string, unknown>>;

/** One keyed value of a kind. */
export interface GraphValueKey {
  valueKey: string;
  keyId: string;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

function keyInputs(kind: GraphKind, value: GraphPlainValue): GraphKeyInput[] {
  const members = typeof value === 'string' ? { value } : value;
  switch (kind) {
    case 'name': {
      const first = text(members['name-first']);
      const last = text(members['name-last']);
      return first === null || last === null
        ? []
        : graphNameKeyInputs({ 'name-first': first, 'name-last': last });
    }
    case 'name_birthdate': {
      const first = text(members['name-first']);
      const last = text(members['name-last']);
      const birthdate = text(members.birthdate);
      return first === null || last === null || birthdate === null
        ? []
        : graphNameBirthdateKeyInputs({ 'name-first': first, 'name-last': last }, birthdate);
    }
    default:
      return [graphKeyInput(kind, members)];
  }
}

/**
 * The value keys of `value` as `kind` under the environment's subkey: one, or several for a name
 * (one per fold). `[]` for a value the kind refuses, and for a kind keyed by an existing index.
 */
export function graphValueKeys(
  key: Uint8Array,
  environmentId: string,
  kind: GraphKind,
  value: GraphPlainValue,
): GraphValueKey[] {
  if (kind === 'government_id_number' || kind === 'chip_signature' || kind === 'crypto_address') {
    return [];
  }
  let inputs: GraphKeyInput[];
  try {
    inputs = keyInputs(kind, value);
  } catch (error) {
    if (error instanceof ListKeyInputError) {
      return [];
    }
    throw error;
  }
  const keyId = blindIndexKeyId(key);
  const seen = new Set<string>();
  const keys: GraphValueKey[] = [];
  for (const input of inputs) {
    const valueKey = identifierKey(key, {
      environmentId,
      kind: input.keyKind,
      input: input.input,
    });
    if (!seen.has(valueKey)) {
      seen.add(valueKey);
      keys.push({ valueKey, keyId });
    }
  }
  return keys;
}
