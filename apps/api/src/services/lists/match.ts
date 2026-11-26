/**
 * C99.1, C99.2 (Workflow 7B; H02, H11, H15, H16, V15, V21): `matchLists`, the one matching service.
 * Owner: `api-lists`. The screening job, `POST /lists/match`, the custom-list report and the
 * compromised-number lookup all read it; the biometric lists answer through
 * `BiometricListMatcher`, which runs before the caller's transaction, and whose outcome comes in
 * through `options.biometric`.
 *
 * A list ends in one or more of three places, and only a list in none but `matches` or in nothing
 * at all was compared in full:
 * - `matches`: each names its list, item, probe source, method and the tier of its evidence (H15):
 *   R for an exact, CIDR or radius match on an R-tier probe; H with a confidence for a fuzzy name,
 *   a background, an IP-derived country or point, and a fingerprint read as "the same device". A
 *   face is R with its score (Phase 4's calibrated threshold), and advisory.
 * - `unscreened`: a value exists and could not be compared, for a closed reason; never "no match".
 * - `notApplicable`: the subject has no value of the list's kind (H16). It was screened, with
 *   nothing to compare, and never makes a screening partial.
 *
 * The methods are the C99.2 table: keys through `match_key` and `list_item_keys`, ranges through the
 * SP-GiST `>>=`, countries on their plaintext column, points through the coarse box and then a
 * haversine over the opened candidates, and first names through the C78 scorer over the last-name
 * candidates, at the watchlist report's default rule set (C79.1 `tolerant`), with no constant of
 * its own (owner decision 9 after Workflow 6C).
 *
 * Nothing here logs, and no error names a value: an unreadable probe is a reason, not a message.
 */
import {
  haversineMeters,
  LIST_KEYS_VERSION,
  ListKeyInputError,
  type ListValue,
} from '@openverify/checks';
import {
  LIST_KIND_REGISTRY,
  LIST_MATCH_CONSTANTS,
  NETWORK_SIGNAL_CONSTANTS,
  type ListKeyKind,
  type ListKind,
  type ListMatchMethod,
  type ListMatchTier,
  type ListNotApplicableReason,
  type ListProbeSource,
  type ListUnscreenedReason,
} from '@openverify/core';
import {
  blindIndexKeyId,
  findCountryListItems,
  findGeoListItems,
  findListItemsByKeys,
  findListItemsInRange,
  findNameCandidates,
  listListItemHealth,
  type Db,
  type ListRow,
} from '@openverify/db';
import {
  analysePersonName,
  listLastNameKeyInputs,
  resolveNameMatching,
  scoreNamePair,
  type ListName,
} from '@openverify/watchlist';
import type { BiometricListOutcome } from '../../ports.js';
import { loadMatcherData, type MatcherData } from '../../watchlists/matcher-data.js';
import { LIST_EVIDENCE_CONSTANTS } from './constants.js';
import { geoBoxes } from './geo.js';
import { hashedKey, probeKeyInputs } from './keys.js';

/** C99.1: one probe: where its values came from, and the values under their wire names. */
export interface ListProbe {
  source: ListProbeSource;
  kind: ListKind;
  values: readonly Readonly<Record<string, unknown>>[];
  /** C93.1 (P05): a value exists, and a client could have chosen it, so it is not compared. */
  untrusted?: boolean;
  /** C99.1: a value exists, and nothing here could read it. */
  unreadable?: boolean;
}

/** C99.1: one match, with its evidence. `matchedValue` is the value compared, for sealing. */
export interface FoundListMatch {
  listId: string;
  listKind: ListKind;
  listVersion: number;
  listItemId: string;
  source: ListProbeSource;
  method: ListMatchMethod;
  tier: ListMatchTier;
  confidence: number | null;
  approximate: boolean;
  score: number | null;
  distanceMeters: number | null;
  matchedValue: string;
}

export interface UnscreenedList {
  'list-id': string;
  reason: ListUnscreenedReason;
}

export interface NotApplicableList {
  'list-id': string;
  reason: ListNotApplicableReason;
}

/** C99.1 (H02). */
export interface ListMatchOutcome {
  matches: FoundListMatch[];
  unscreened: UnscreenedList[];
  notApplicable: NotApplicableList[];
}

export interface MatchListsOptions {
  /** The blind-index key of the match keys. */
  key: Uint8Array;
  /** The selected lists, as read. */
  lists: readonly ListRow[];
  /** C99.4: exact, CIDR and radius only (P25). */
  onDemand?: boolean | undefined;
  /** C99.7: the matcher's answer for the biometric lists; `no_subject` with no inquiry to read. */
  biometric?: BiometricListOutcome | 'no_subject' | undefined;
  /** The C78 variant groups; the shipped file by default. */
  matcherData?: MatcherData | undefined;
  /** C99.2: `LIST_MATCH_CONSTANTS`' cap by default. */
  fuzzyCandidateCap?: number | undefined;
}

const constantOf = (table: Readonly<Record<string, { value: unknown }>>, name: string): number =>
  Number(table[name]?.value);

/** C95.3: how far an IP city point may be from the person. */
const ipCityUncertainty = () => constantOf(NETWORK_SIGNAL_CONSTANTS, 'ip-city-uncertainty-meters');

/** C99.1: where each IP-derived or device-derived evidence stands. */
function evidenceOf(
  source: ListProbeSource,
  kind: ListKind,
): Pick<FoundListMatch, 'tier' | 'confidence' | 'approximate'> {
  if (source === 'session.ip-country') {
    return {
      tier: 'H',
      confidence: constantOf(NETWORK_SIGNAL_CONSTANTS, 'ip-country-confidence'),
      approximate: true,
    };
  }
  if (source === 'session.ip-point') {
    return {
      tier: 'H',
      confidence: constantOf(LIST_EVIDENCE_CONSTANTS, 'ip-point-confidence'),
      approximate: true,
    };
  }
  if (LIST_KIND_REGISTRY[kind].keyed) {
    return {
      tier: 'H',
      confidence: constantOf(LIST_EVIDENCE_CONSTANTS, 'same-device-confidence'),
      approximate: false,
    };
  }
  return { tier: 'R', confidence: null, approximate: false };
}

/** The value compared, as a match seals it. */
function comparedValue(kind: ListKind, value: ListValue): string {
  switch (kind) {
    case 'country':
      return String(value['country-code']);
    case 'geolocation':
      return `${String(value.latitude)},${String(value.longitude)}`;
    case 'government-id-number':
      return String(value['id-number']);
    case 'field':
      return String(value['field-value']);
    case 'name':
      return `${String(value['name-first'])} ${String(value['name-last'])}`;
    default:
      return String(value.value);
  }
}

/** One value of one probe, as the methods carry it. */
interface ProbeValue {
  source: ListProbeSource;
  value: ListValue;
}

/** The run's answer as it builds. */
class MatchRun {
  private readonly matches = new Map<string, FoundListMatch>();
  private readonly unscreened = new Map<string, UnscreenedList>();
  private readonly notApplicable: NotApplicableList[] = [];

  add(match: FoundListMatch): void {
    const key = `${match.listItemId}\u0000${match.source}`;
    if (!this.matches.has(key)) {
      this.matches.set(key, match);
    }
  }

  has(itemId: string, source: ListProbeSource): boolean {
    return this.matches.has(`${itemId}\u0000${source}`);
  }

  unread(listId: string, reason: ListUnscreenedReason): void {
    this.unscreened.set(`${listId}\u0000${reason}`, { 'list-id': listId, reason });
  }

  nothingToCompare(listId: string): void {
    this.notApplicable.push({ 'list-id': listId, reason: 'subject_has_no_value' });
  }

  outcome(): ListMatchOutcome {
    return {
      matches: [...this.matches.values()],
      unscreened: [...this.unscreened.values()],
      notApplicable: this.notApplicable,
    };
  }
}

const found = (
  list: ListRow,
  listItemId: string,
  { source, value }: ProbeValue,
  method: ListMatchMethod,
  extra: Partial<FoundListMatch> = {},
): FoundListMatch => ({
  listId: list.id,
  listKind: list.type,
  listVersion: list.version,
  listItemId,
  source,
  method,
  ...evidenceOf(source, list.type),
  score: null,
  distanceMeters: null,
  matchedValue: comparedValue(list.type, value),
  ...extra,
});

/** A field probe reads only the list of its own key (C98.2). */
function fieldProbeFits(list: ListRow, value: ListValue): boolean {
  const named = value['field-key'];
  return list.type !== 'field' || named === undefined || named === list.fieldKey;
}

/** C99.2: compares the keyed kinds of `lists` in one read per table. */
async function matchByKeys(
  tx: Db,
  environmentId: string,
  run: MatchRun,
  entries: readonly { list: ListRow; values: readonly ProbeValue[] }[],
  key: Uint8Array,
): Promise<void> {
  const keys = new Map<string, Map<string, ProbeValue[]>>();
  const kinds = new Set<ListKeyKind>();
  for (const { list, values } of entries) {
    const held = new Map<string, ProbeValue[]>();
    for (const probe of values) {
      for (const input of probeKeyInputs(list, probe.value)) {
        const hashed = hashedKey(key, environmentId, input);
        held.set(hashed, [...(held.get(hashed) ?? []), probe]);
        kinds.add(input.keyKind);
      }
    }
    keys.set(list.id, held);
  }
  const lists = new Map(entries.map(({ list }) => [list.id, list]));
  const hits = await findListItemsByKeys(tx, environmentId, {
    listIds: [...lists.keys()],
    keys: [...new Set([...keys.values()].flatMap((held) => [...held.keys()]))],
    keyKinds: [...kinds].filter((kind) => kind === 'identifier-name'),
    normaliserVersion: LIST_KEYS_VERSION,
    keyId: blindIndexKeyId(key),
  });
  for (const { itemId, listId, key: hit } of hits) {
    const list = lists.get(listId);
    for (const probe of keys.get(listId)?.get(hit) ?? []) {
      if (list !== undefined) {
        run.add(found(list, itemId, probe, 'exact'));
      }
    }
  }
}

/** C99.2: `range >>= $probe` on the plaintext rows; the address in the keys' canonical text. */
async function matchRanges(
  tx: Db,
  environmentId: string,
  run: MatchRun,
  list: ListRow,
  values: readonly ProbeValue[],
): Promise<void> {
  for (const probe of values) {
    const [input] = probeKeyInputs(list, probe.value);
    if (input !== undefined) {
      const hits = await findListItemsInRange(tx, environmentId, {
        listIds: [list.id],
        address: input.input,
        normaliserVersion: LIST_KEYS_VERSION,
      });
      for (const { itemId } of hits) {
        run.add(found(list, itemId, probe, 'cidr'));
      }
    }
  }
}

/** C98.2: a country on its plaintext column. */
async function matchCountries(
  tx: Db,
  environmentId: string,
  run: MatchRun,
  list: ListRow,
  values: readonly ProbeValue[],
): Promise<void> {
  const byCode = new Map<string, ProbeValue[]>();
  for (const probe of values) {
    const [input] = probeKeyInputs(list, probe.value);
    if (input !== undefined) {
      byCode.set(input.input, [...(byCode.get(input.input) ?? []), probe]);
    }
  }
  const hits = await findCountryListItems(tx, environmentId, {
    listIds: [list.id],
    codes: [...byCode.keys()],
    normaliserVersion: LIST_KEYS_VERSION,
  });
  for (const { itemId, countryCode } of hits) {
    for (const probe of byCode.get(countryCode) ?? []) {
      run.add(found(list, itemId, probe, 'exact'));
    }
  }
}

/**
 * C99.2, C95.3: a probe's point against the sealed points the coarse boxes let through. A point
 * from the session's address carries `IP_CITY_UNCERTAINTY_METERS`: it matches within the item's
 * radius plus that, and an item it cannot tell apart, smaller than its uncertainty and within
 * reach, is `probe_too_coarse`, never "no match". The boxes are the probe's own reach, because an
 * item whose centre is outside it can still reach the probe.
 */
async function matchPoints(
  tx: Db,
  environmentId: string,
  run: MatchRun,
  list: ListRow,
  values: readonly ProbeValue[],
): Promise<void> {
  for (const probe of values) {
    probeKeyInputs(list, probe.value);
    const latitude = Number(probe.value.latitude);
    const longitude = Number(probe.value.longitude);
    const uncertainty = probe.source === 'session.ip-point' ? ipCityUncertainty() : 0;
    const reach = Math.max(uncertainty, 1);
    const candidates = await findGeoListItems(tx, environmentId, {
      listIds: [list.id],
      boxes: geoBoxes(latitude, longitude, reach),
      normaliserVersion: LIST_KEYS_VERSION,
    });
    for (const { itemId, value } of candidates) {
      const radius = Number(value['radius-meters']);
      const distanceMeters = haversineMeters(
        { latitude, longitude },
        { latitude: Number(value.latitude), longitude: Number(value.longitude) },
      );
      if (distanceMeters > radius + uncertainty) {
        continue;
      }
      if (radius < uncertainty) {
        run.unread(list.id, 'probe_too_coarse');
        continue;
      }
      run.add(found(list, itemId, probe, 'radius', { distanceMeters }));
    }
  }
}

/**
 * C99.2 (F17): the fuzzy first names of one list. Candidates share a last-name key; at most the cap
 * is opened, and beyond it the list is `limit_exceeded`, never a silent cap. The C78 scorer takes
 * whole names (it anchors on the family token, and scores a given name alone as 0): the last names
 * already agree, so the first names decide, and the rule set's minimum applies.
 */
async function matchFirstNames(
  tx: Db,
  environmentId: string,
  run: MatchRun,
  list: ListRow,
  values: readonly ProbeValue[],
  options: MatchListsOptions,
): Promise<void> {
  const data = options.matcherData ?? loadMatcherData();
  if (data.status !== 'loaded') {
    run.unread(list.id, 'probe_unavailable');
    return;
  }
  const matching = resolveNameMatching({ preset: 'tolerant' });
  const cap =
    options.fuzzyCandidateCap ?? constantOf(LIST_MATCH_CONSTANTS, 'fuzzy-name-candidate-cap');
  for (const probe of values) {
    const name = probe.value as unknown as ListName;
    const candidates = await findNameCandidates(tx, environmentId, {
      listId: list.id,
      keys: listLastNameKeyInputs(name).map((input) => hashedKey(options.key, environmentId, input)),
      limit: cap + 1,
      normaliserVersion: LIST_KEYS_VERSION,
    });
    if (candidates.length > cap) {
      run.unread(list.id, 'limit_exceeded');
      continue;
    }
    const subject = analysePersonName({ first: name['name-first'], last: name['name-last'] });
    for (const { itemId, value } of candidates) {
      if (run.has(itemId, probe.source)) {
        continue;
      }
      const candidate = analysePersonName({
        first: String(value['name-first']),
        last: String(value['name-last']),
      });
      const { score } = scoreNamePair(subject, candidate, matching, data.groups);
      if (score >= (matching.minScore ?? 1)) {
        run.add(
          found(list, itemId, probe, 'fuzzy_name', {
            tier: 'H',
            confidence: score,
            score,
          }),
        );
      }
    }
  }
}

/** Runs one list-level step; a value its normaliser refuses leaves the list unscreened. */
async function reading(run: MatchRun, list: ListRow, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (!(error instanceof ListKeyInputError)) {
      throw error;
    }
    run.unread(list.id, 'probe_unavailable');
  }
}

/** Keeps the values `list` can read of `values`: the rest leave it unscreened. */
function readableValues(
  run: MatchRun,
  list: ListRow,
  values: readonly ProbeValue[],
): ProbeValue[] {
  return values.filter(({ value }) => {
    try {
      probeKeyInputs(list, value);
      return true;
    } catch (error) {
      if (!(error instanceof ListKeyInputError)) {
        throw error;
      }
      run.unread(list.id, 'probe_unavailable');
      return false;
    }
  });
}

/** C99.7: the biometric lists, from the matcher's outcome. */
function applyBiometric(
  run: MatchRun,
  lists: readonly ListRow[],
  biometric: MatchListsOptions['biometric'],
  onDemand: boolean,
): void {
  for (const list of lists) {
    if (onDemand) {
      run.unread(list.id, 'method_not_on_demand');
    } else if (biometric === 'no_subject') {
      run.nothingToCompare(list.id);
    } else if (biometric === undefined) {
      run.unread(list.id, 'list_items_pending');
    }
  }
  if (biometric === undefined || biometric === 'no_subject' || onDemand) {
    return;
  }
  const kinds = new Map(lists.map((list) => [list.id, list.type]));
  for (const match of biometric.matches) {
    const kind = kinds.get(match.listId);
    if (kind !== undefined) {
      run.add({
        listId: match.listId,
        listKind: kind,
        listVersion: match.listVersion,
        listItemId: match.listItemId,
        source: 'selfie.center',
        method: match.method,
        tier: match.method === 'background' ? 'H' : 'R',
        confidence: match.method === 'background' ? match.score : null,
        approximate: false,
        score: match.score,
        distanceMeters: null,
        matchedValue: 'selfie.center',
      });
    }
  }
  for (const { 'list-id': listId, reason } of biometric.unscreened) {
    run.unread(listId, reason);
  }
}

/**
 * C99.1: compares `probes` with `options.lists`. Reads only: the caller writes what it keeps.
 */
export async function matchLists(
  tx: Db,
  environmentId: string,
  probes: readonly ListProbe[],
  options: MatchListsOptions,
): Promise<ListMatchOutcome> {
  const run = new MatchRun();
  const onDemand = options.onDemand === true;
  const active = options.lists.filter((list) => {
    if (list.status === 'archived') {
      run.unread(list.id, 'list_archived');
    }
    return list.status !== 'archived';
  });
  applyBiometric(
    run,
    active.filter((list) => LIST_KIND_REGISTRY[list.type].biometric),
    options.biometric,
    onDemand,
  );
  const compared: { list: ListRow; values: ProbeValue[] }[] = [];
  for (const list of active.filter((entry) => !LIST_KIND_REGISTRY[entry.type].biometric)) {
    if (onDemand && list.allowFuzzyNameFirst) {
      run.unread(list.id, 'method_not_on_demand');
      continue;
    }
    const own = probes.filter(({ kind }) => kind === list.type);
    if (own.some(({ untrusted }) => untrusted === true)) {
      run.unread(list.id, 'client_address_untrusted');
    }
    if (own.some(({ unreadable }) => unreadable === true)) {
      run.unread(list.id, 'probe_unavailable');
    }
    const values = own.flatMap(({ source, values: held }) =>
      held
        .filter((value) => fieldProbeFits(list, value))
        .map((value): ProbeValue => ({ source, value })),
    );
    if (values.length === 0) {
      if (!own.some(({ untrusted, unreadable }) => untrusted === true || unreadable === true)) {
        run.nothingToCompare(list.id);
      }
      continue;
    }
    compared.push({ list, values: readableValues(run, list, values) });
  }
  const health = await listListItemHealth(
    tx,
    environmentId,
    compared.map(({ list }) => list.id),
    { normaliserVersion: LIST_KEYS_VERSION, keyId: blindIndexKeyId(options.key) },
  );
  for (const { list } of compared) {
    const state = health.get(list.id);
    if (state?.outdated === true) {
      run.unread(list.id, 'normaliser_outdated');
    }
    if (state?.rotated === true) {
      run.unread(list.id, 'key_rotated');
    }
  }
  await matchByKeys(
    tx,
    environmentId,
    run,
    compared.filter(({ list }) => list.type !== 'country' && list.type !== 'geolocation'),
    options.key,
  );
  for (const { list, values } of compared) {
    await reading(run, list, async () => {
      if (list.type === 'ip-address') {
        await matchRanges(tx, environmentId, run, list, values);
      } else if (list.type === 'country') {
        await matchCountries(tx, environmentId, run, list, values);
      } else if (list.type === 'geolocation') {
        await matchPoints(tx, environmentId, run, list, values);
      } else if (list.allowFuzzyNameFirst && !onDemand) {
        await matchFirstNames(tx, environmentId, run, list, values, options);
      }
    });
  }
  return run.outcome();
}
