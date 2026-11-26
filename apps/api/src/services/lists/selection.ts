/**
 * C99.5 (Workflow 7B; V21): which lists a screening reads. `all` is every active list of the kinds
 * it covers with `screen-at-completion`; a kind the environment does not collect is left out and
 * recorded as `kind_not_collected`, which never makes a screening partial, because `all` never
 * selected it. A named list is read whatever it is: one archived since is `list_archived`, one of
 * a kind no longer collected is `kind_not_collected`, and each makes the screening partial.
 */
import { LIST_KIND_REGISTRY, type ListKind } from '@openverify/core';
import {
  getLists,
  listListsScreenedByAll,
  listNetworkSourceStates,
  resolveSignalSettings,
  type Db,
  type Environment,
  type ListRow,
} from '@openverify/db';
import type { ResolvedListConfig } from '@openverify/contracts';
import type { UnscreenedList } from './match.js';

/** C92.1: the source that gives a session a point, and the bundle a sandbox reads instead. */
const CITY_SOURCES = ['dbip-city-lite', 'openverify-sandbox-network'] as const;

/** C99.5 (V21): the kinds no session of this environment can hold a value of. */
export async function kindsNotCollected(
  tx: Db,
  environment: Pick<Environment, 'kind' | 'settings'>,
): Promise<ReadonlySet<ListKind>> {
  const kinds = new Set<ListKind>();
  const { 'signal-collection': collection } = resolveSignalSettings(environment.settings);
  if (collection['device-recognition'] === 'off') {
    kinds.add('browser-fingerprint').add('device-fingerprint');
  }
  const [city, sandbox] = CITY_SOURCES;
  const states = await listNetworkSourceStates(tx);
  const enabled = new Set(states.filter((state) => state.enabled).map(({ id }) => id));
  const hasPoints =
    enabled.has(city) || (environment.kind === 'sandbox' && enabled.has(sandbox));
  if (!hasPoints) {
    kinds.add('geolocation');
  }
  return kinds;
}

/** What a screening reads, and what it records without reading. */
export interface ListSelection {
  lists: ListRow[];
  /** Named lists it could not select: each makes the screening partial. */
  unscreened: UnscreenedList[];
  /** Left out of `all`: recorded, and no part of the screening (V21). */
  leftOut: UnscreenedList[];
}

const notCollected = ({ id }: ListRow): UnscreenedList => ({
  'list-id': id,
  reason: 'kind_not_collected',
});

/** C99.5: reads `screen` into the lists of a screening. */
export async function selectScreenedLists(
  tx: Db,
  environment: Pick<Environment, 'id' | 'kind' | 'settings'>,
  screen: ResolvedListConfig['screen'],
): Promise<ListSelection> {
  if (screen === 'none') {
    return { lists: [], unscreened: [], leftOut: [] };
  }
  const missing = await kindsNotCollected(tx, environment);
  if (screen === 'all') {
    const screened = await listListsScreenedByAll(tx, environment.id);
    return {
      lists: screened.filter(({ type }) => !missing.has(type)),
      unscreened: [],
      leftOut: screened.filter(({ type }) => missing.has(type)).map(notCollected),
    };
  }
  const named = await getLists(tx, environment.id, screen);
  const held = new Set(named.map(({ id }) => id));
  return {
    lists: named.filter(
      ({ type, status }) => status === 'archived' || !missing.has(type),
    ),
    unscreened: [
      ...screen
        .filter((id) => !held.has(id))
        .map((id): UnscreenedList => ({ 'list-id': id, reason: 'list_archived' })),
      ...named
        .filter(({ type, status }) => status !== 'archived' && missing.has(type))
        .map(notCollected),
    ],
    leftOut: [],
  };
}

/** The biometric lists of a selection, as the matcher takes them. */
export const biometricSelection = (lists: readonly ListRow[]) =>
  lists.flatMap((list) =>
    LIST_KIND_REGISTRY[list.type].biometric && list.status === 'active'
      ? [{ id: list.id, kind: list.type as 'face' | 'selfie-background', version: list.version }]
      : [],
  );
