/**
 * C102.2, C102.4 (Workflow 7B; P11, P17): binding a `parameter-map` to a published template. Values
 * are bound, never interpreted: each start clause's `{{param}}` is keyed under its kind's label (as
 * the indexer keys what it writes, so a parameter meets a row on one key), an `account_id` names an
 * account, a `created_at` window parameter is a time. Nothing here logs; a refusal names the
 * parameter, never its value.
 *
 * - A parameter the template uses and the map lacks answers 422 `graph_parameter_missing`; one the
 *   template does not declare, 422 with its pointer.
 * - A parameter of a kind that identifies a person (`GRAPH_PERSON_KINDS`) needs `pii:view` too:
 *   403 `graph_parameter_not_allowed` (P11).
 * - A text kind binds the text. A kind of several members binds a JSON object of the list item's
 *   members (ours): `name` `{"name-first", "name-last"}`, `name_birthdate` with `birthdate`,
 *   `address` its six `address-*` members, `government_id_number` `{"issuing-authority-code",
 *   "identification-number", "id-class"?}` (the C31.8 index), `crypto_address`
 *   `{"chain-id", "address"}` (the C53.2 index). `chip_signature` has no plaintext to bind.
 * - A value its kind refuses answers 422 with its pointer: there is no key to search for.
 */
import { idSchema, type GraphQueryTemplateConfig } from '@openverify/contracts';
import {
  GRAPH_KIND_REGISTRY,
  graphKindCode,
  idClassSchema,
  type GraphKind,
} from '@openverify/core';
import {
  blindIndexKeyId,
  canonicalCryptoAddress,
  cryptoAddressIndex,
  idClassGroup,
  identificationNumberIndex,
} from '@openverify/db';
import { GraphProblemError, UnprocessableContentError } from '../../errors.js';
import { graphValueKeys } from './keys.js';
import { newGraphNodeId, type GraphNodeMapEntry, type GraphStartValue } from './query.js';

export interface BoundGraphQuery {
  startAccounts: string[];
  startValues: GraphStartValue[];
  createdAtStart: Date | null;
  createdAtEnd: Date | null;
  /** The node map a submitted query holds before its run (`setGraphQueryStart`). */
  startMap: Record<string, GraphNodeMapEntry>;
}

const nameOf = (placeholder: string) => placeholder.slice(2, -2);

const pointerOf = (name: string) => `/data/attributes/parameter-map/${name}`;

const unreadable = (name: string, kind: string) =>
  new UnprocessableContentError(`The parameter ${name} cannot be read as ${kind}.`, [
    { location: 'body', pointer: pointerOf(name), detail: `not a ${kind}` },
  ]);

function jsonOf(text: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** The value keys of one bound start value; `[]` when its kind refuses it. */
function startKeys(
  key: Uint8Array,
  environmentId: string,
  kind: GraphKind,
  value: string,
): string[] {
  switch (kind) {
    case 'name':
    case 'name_birthdate':
    case 'address': {
      const members = jsonOf(value);
      return members === null
        ? []
        : graphValueKeys(key, environmentId, kind, members).map(({ valueKey }) => valueKey);
    }
    case 'government_id_number': {
      const members = jsonOf(value);
      const issuer = textOf(members?.['issuing-authority-code']);
      const number = textOf(members?.['identification-number']);
      const idClass = idClassSchema.safeParse(members?.['id-class']);
      if (issuer === null || number === null) {
        return [];
      }
      const index = identificationNumberIndex(key, {
        environmentId,
        issuingAuthorityCode: issuer,
        classGroup: idClassGroup(idClass.success ? idClass.data : null),
        identificationNumber: number,
      });
      return index === null ? [] : [index];
    }
    case 'crypto_address': {
      const members = jsonOf(value);
      const chain = textOf(members?.['chain-id']);
      const address = textOf(members?.address);
      return chain === null || address === null
        ? []
        : [
            cryptoAddressIndex(key, {
              environmentId,
              address: canonicalCryptoAddress(chain, address),
            }),
          ];
    }
    case 'chip_signature':
      return [];
    default:
      return graphValueKeys(key, environmentId, kind, value).map(({ valueKey }) => valueKey);
  }
}

function timeOf(name: string, value: string): Date {
  const time = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}/u.test(value) || Number.isNaN(time.getTime())) {
    throw unreadable(name, 'created_at');
  }
  return time;
}

/**
 * Binds `params` to `config` in `environmentId`, for a caller who `mayViewPii` or not: a principal's
 * `canViewPii`, or a run's grant (Stage 1a amendment 5).
 * @throws {GraphProblemError} `graph_parameter_missing` (422), `graph_parameter_not_allowed` (403).
 * @throws {UnprocessableContentError} for an undeclared parameter or a value its kind refuses.
 */
export function bindGraphQuery(
  key: Uint8Array,
  environmentId: string,
  mayViewPii: boolean,
  config: GraphQueryTemplateConfig,
  params: Readonly<Record<string, string>>,
): BoundGraphQuery {
  const declared = new Map(config.parameters.map(({ name, kind }) => [name, kind]));
  for (const name of Object.keys(params)) {
    if (!declared.has(name)) {
      throw new UnprocessableContentError(`The template declares no parameter ${name}.`, [
        { location: 'body', pointer: pointerOf(name), detail: 'not declared' },
      ]);
    }
  }
  const valueOf = (placeholder: string): string => {
    const name = nameOf(placeholder);
    const value = params[name];
    if (value === undefined) {
      throw new GraphProblemError('graph_parameter_missing', `The parameter ${name} is missing.`, {
        errors: [{ location: 'body', pointer: pointerOf(name), detail: 'missing' }],
      });
    }
    const kind = declared.get(name);
    if (
      kind !== undefined &&
      kind !== 'account_id' &&
      kind !== 'created_at' &&
      GRAPH_KIND_REGISTRY[kind].identifiesPerson &&
      !mayViewPii
    ) {
      throw new GraphProblemError(
        'graph_parameter_not_allowed',
        `The parameter ${name} identifies a person, which needs pii:view.`,
      );
    }
    return value;
  };

  const bound: BoundGraphQuery = {
    startAccounts: [],
    startValues: [],
    createdAtStart: null,
    createdAtEnd: null,
    startMap: {},
  };
  const keyId = blindIndexKeyId(key);
  for (const clause of config.start) {
    const name = nameOf(clause.value);
    const value = valueOf(clause.value);
    if (clause.kind === 'account_id') {
      if (!idSchema('acc').safeParse(value).success) {
        throw unreadable(name, 'account_id');
      }
      bound.startAccounts.push(value);
      bound.startMap[value] = { start: true, account: true };
      continue;
    }
    const keys = startKeys(key, environmentId, clause.kind, value);
    if (keys.length === 0) {
      throw unreadable(name, clause.kind);
    }
    for (const valueKey of keys) {
      const nodeId = newGraphNodeId();
      const start: GraphStartValue = {
        nodeId,
        kind: clause.kind,
        valueKey,
        keyId,
        parameter: name,
      };
      bound.startValues.push(start);
      bound.startMap[nodeId] = {
        kind: graphKindCode(clause.kind),
        valueKey,
        keyId,
        start: true,
        parameter: name,
      };
    }
  }
  const window = config.filters;
  if (window?.['created-at-start'] !== undefined) {
    bound.createdAtStart = timeOf(
      nameOf(window['created-at-start']),
      valueOf(window['created-at-start']),
    );
  }
  if (window?.['created-at-end'] !== undefined) {
    bound.createdAtEnd = timeOf(
      nameOf(window['created-at-end']),
      valueOf(window['created-at-end']),
    );
  }
  return bound;
}
