/**
 * C101.3 (Workflow 7B; F03): the in-transaction indexer. Each caller holds the plaintext already
 * and passes it in its own transaction; the indexer keys each value under its kind's identifier
 * label (`identifierKey`, the environment's subkey) and writes `graph_attributes` rows. Nothing is
 * logged, and no value leaves the call. The hook points:
 *
 * - account field writes (`services/accounts.ts`: `POST /accounts`, `PATCH /accounts/:id`, and the
 *   account `resolveForInquiry` creates with a reference id): `account-fields`, source `account`;
 * - the session start (`services/inquiry-sessions.ts`, through `indexSessionAddressInTx`): the IP
 *   row, source `inquiry-session`, written only with `graph-weak-kinds` on, never for a `trust-all`
 *   address in production (P05), never for a non-global, relay or documentation range outside a
 *   sandbox;
 * - linking an inquiry to an account (`add-objects`, `remove-objects`): `inquiry-linked`, source
 *   `inquiry`, which moves the inquiry's rows to the account.
 *
 * Every row is written with `graph-indexing` on only, and a fingerprint kind only for sessions
 * under the device-recognition tier. A hook that throws rolls the caller's change back, so it never
 * throws on a value it cannot key: it leaves that value out.
 *
 * The key is the process's blind-index key (`graphIndexKey`, `keys.ts`): the frozen signature
 * carries none. A process without one writes nothing. Owner: `api-graph`; `foundation-7b` (Stage 1b
 * (G)) froze the signature.
 */
import { graphKindCode } from '@openverify/core';
import {
  getEnvironment,
  listSessionNetworks,
  moveInquiryGraphAttributes,
  replaceAccountGraphAttributes,
  upsertGraphAttributes,
  type Db,
  type GraphSourceType,
  type Inquiry,
  type NewGraphAttribute,
} from '@openverify/db';
import {
  accountGraphValues,
  inquiryGraphValues,
  sessionAddressValues,
  type GraphValue,
} from './collect.js';
import { graphIndexKey } from './keys.js';
import { graphSettingsOf, type GraphSettings } from './settings.js';

/** What the rows come from (`graph_attributes.source_type`, `source_id`, `inquiry_id`). */
export type GraphIndexSource =
  | { type: Extract<GraphSourceType, 'account'>; id: string }
  | { type: Extract<GraphSourceType, 'inquiry'>; id: string }
  | {
      type: Extract<GraphSourceType, 'inquiry-session' | 'verification'>;
      id: string;
      inquiryId: string;
    };

/** The plaintext the caller holds, by what it is. */
export type GraphAttributesInput =
  | {
      kind: 'account-fields';
      referenceId: string | null;
      fields: Readonly<Record<string, unknown>>;
    }
  | {
      /** The session's address as evaluated, and the network row with its class and trust mode. */
      kind: 'session-address';
      ip: string;
      networkId: string;
    }
  | {
      /** The inquiry now belongs to the account: its rows move there. */
      kind: 'inquiry-linked';
    };

export type IndexAccountAttributesInTx = (
  tx: Db,
  environmentId: string,
  accountId: string,
  source: GraphIndexSource,
  attributes: GraphAttributesInput,
) => Promise<number>;

/** The rows of `values`, all held by `accountId`. */
export function graphAttributeRows(
  accountId: string,
  values: readonly GraphValue[],
): NewGraphAttribute[] {
  return values.map(({ kind, valueKey, keyId, source }) => ({
    kind: graphKindCode(kind),
    valueKey,
    keyId,
    accountId,
    sourceType: source.type,
    sourceId: source.id,
    inquiryId:
      source.type === 'account' ? null : source.type === 'inquiry' ? source.id : source.inquiryId,
  }));
}

/** Returns how many rows it wrote or moved. */
export const indexAccountAttributesInTx: IndexAccountAttributesInTx = async (
  tx,
  environmentId,
  accountId,
  source,
  attributes,
) => {
  if (attributes.kind === 'inquiry-linked') {
    // The inquiry's rows follow it, whatever the settings say now: they were written under them.
    return source.type === 'inquiry'
      ? moveInquiryGraphAttributes(tx, environmentId, { inquiryIds: [source.id], accountId })
      : 0;
  }
  const key = graphIndexKey();
  const environment = key === null ? null : await getEnvironment(tx, environmentId);
  if (key === null || environment === null) {
    return 0;
  }
  const settings = graphSettingsOf(environment);
  if (!settings.indexing) {
    return 0;
  }
  const at = new Date();
  if (attributes.kind === 'account-fields') {
    const values = accountGraphValues(key, environmentId, settings, {
      id: accountId,
      referenceId: attributes.referenceId,
      fields: attributes.fields,
    });
    return replaceAccountGraphAttributes(
      tx,
      environmentId,
      accountId,
      graphAttributeRows(accountId, values),
      at,
    );
  }
  if (source.type !== 'inquiry-session') {
    return 0;
  }
  // The network row is the evaluation's record: its address, class and trust mode decide (P05).
  const [network] = (await listSessionNetworks(tx, environmentId, [source.id])).filter(
    ({ id }) => id === attributes.networkId,
  );
  if (network === undefined) {
    return 0;
  }
  const values = sessionAddressValues(key, environmentId, settings, network, source);
  return upsertGraphAttributes(tx, environmentId, graphAttributeRows(accountId, values), at);
};

/**
 * The `graph-index` job's, the backfill's and the rebuild's write: everything an inquiry holds, to
 * its account. Returns how many rows were new.
 */
export async function indexInquiryInTx(
  tx: Db,
  key: Uint8Array,
  settings: GraphSettings,
  inquiry: Inquiry,
  at: Date,
): Promise<number> {
  const values = await inquiryGraphValues(tx, key, settings, inquiry);
  return upsertGraphAttributes(
    tx,
    inquiry.environmentId,
    graphAttributeRows(inquiry.accountId, values),
    at,
  );
}

/** The backfill's and the rebuild's write of an account's own values. */
export async function indexAccountInTx(
  tx: Db,
  key: Uint8Array,
  settings: GraphSettings,
  account: { id: string; environmentId: string; referenceId: string | null; fields: unknown },
  at: Date,
): Promise<number> {
  if (!settings.indexing) {
    return 0;
  }
  const values = accountGraphValues(key, account.environmentId, settings, account);
  return replaceAccountGraphAttributes(
    tx,
    account.environmentId,
    account.id,
    graphAttributeRows(account.id, values),
    at,
  );
}
