/**
 * C127.4: Get List Match, over C99.1's engine on demand (exact, CIDR and radius), never
 * `POST /lists/match`'s service and its token. `false` only when every configured list was screened;
 * a list that could not be read gives `null` with its reason and, by default, `list_unavailable`. A
 * match stands whatever else could not be read, because it is known.
 */
import { getLists, listActiveListsOfKinds } from '@openverify/db';
import type { ListKind } from '@openverify/core';
import {
  getListMatchConfigSchema,
  type GetListMatchConfig,
} from '@openverify/workflow-engine/actions';
import { matchLists, type ListProbe } from '../../../services/lists/match.js';
import type { OutsideActionHandler } from '../../engine/action-port.js';
import { answering, apiDepsOf, configOf } from '../shared.js';

/** C127.4: a probe's numbers stay templates, so they are numbers again here. */
function valueOf(probe: GetListMatchConfig['probe']) {
  if (probe.kind === 'geolocation') {
    return { latitude: Number(probe.latitude), longitude: Number(probe.longitude) };
  }
  return Object.fromEntries(Object.entries(probe).filter(([member]) => member !== 'kind'));
}

export const GET_LIST_MATCH_HANDLER: OutsideActionHandler = {
  key: 'get_list_match',
  version: 1,
  shape: 'outside',
  execute: (context) =>
    answering(async () => {
      const config = configOf(context, getListMatchConfigSchema);
      const { db, blindIndexKey } = apiDepsOf(context);
      const { environmentId } = context;
      const named = config['list-ids'];
      const kind = config.probe.kind as ListKind;
      const lists =
        named === undefined
          ? await listActiveListsOfKinds(db, environmentId, [kind])
          : await getLists(db, environmentId, named);
      const held = new Set(lists.map(({ id }) => id));
      const probe: ListProbe = { source: 'request', kind, values: [valueOf(config.probe)] };
      const outcome = await matchLists(db, environmentId, [probe], {
        key: blindIndexKey,
        lists,
        onDemand: true,
      });
      const unscreened = [
        ...(named ?? [])
          .filter((id) => !held.has(id))
          .map((id) => ({ 'list-id': id, reason: 'list_archived' as const })),
        ...outcome.unscreened,
      ];
      const subjects = outcome.matches.map(({ listItemId }) => ({
        subjectId: listItemId,
        source: 'read' as const,
      }));
      const [first] = unscreened;
      if (outcome.matches.length === 0 && first !== undefined) {
        const output = { matched: null, 'null-reason': first.reason, matches: [] };
        return config['on-unscreened'] === 'error'
          ? { kind: 'failed', code: 'list_unavailable', output, subjects }
          : { kind: 'succeeded', output, subjects };
      }
      return {
        kind: 'succeeded',
        output: {
          matched: outcome.matches.length > 0,
          'null-reason': null,
          matches: outcome.matches.map((match) => ({
            'list-item-id': match.listItemId,
            method: match.method,
            tier: match.tier,
            stage: match.tier === 'H' ? 'beta' : 'ga',
            confidence: match.confidence,
            approximate: match.approximate,
          })),
        },
        subjects,
      };
    }),
};
