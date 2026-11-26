/**
 * C99.9 (Workflow 7B; H09, P13): the `id_compromised_detection` lookup the government ID job calls:
 * an exact match of the extraction's number and class against every active government ID number
 * list opted in with `use-for-compromised-ids`. Owner: `api-lists`.
 *
 * It answers `null` with no such list, which leaves the check's input absent. A list it could not
 * read is `unscreened` (`normaliser_outdated` after an upgrade, say), which the check answers
 * `not_applicable`, so a required check goes to review and never reads `passed`. A match also
 * writes one `list-match` record with its event, the record the screening's count then reads; a
 * retried job writes none. The answer's `screened` feeds the check's metadata.
 *
 * `unbuiltCompromisedIdLookup` stays until the worker builds the real one.
 */
import { newId } from '@openverify/contracts';
import {
  getInquiry,
  insertListMatches,
  listCompromisedIdLists,
  type Db,
  type ListRow,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import type { CompromisedIdAnswer, CompromisedIdLookup } from '../../ports.js';
import { matchLists, type FoundListMatch } from './match.js';
import { listMatchEventPayload } from './resources.js';

export const unbuiltCompromisedIdLookup: CompromisedIdLookup = {
  lookup: () => Promise.resolve(null),
};

/** What the check's metadata reads beside the frozen answer. */
export interface ScreenedCompromisedIdAnswer extends CompromisedIdAnswer {
  screened: string[];
}

export interface CompromisedIdLookupDeps {
  db: Db;
  blindIndexKey: Uint8Array;
  events: TransactionalEventPublisher;
}

/** The C99.9 records of `matches`, and their events, once. */
async function recordMatches(
  { db, events }: CompromisedIdLookupDeps,
  inquiry: { environmentId: string; id: string; accountId: string },
  matches: readonly FoundListMatch[],
  lists: readonly ListRow[],
): Promise<void> {
  const kinds = new Map(lists.map((list) => [list.id, list.type]));
  const staged = await db.transaction(async (tx) => {
    const written = await insertListMatches(
      tx,
      inquiry.environmentId,
      matches.map((match) => ({
        id: newId('lmt'),
        listId: match.listId,
        listItemId: match.listItemId,
        inquiryId: inquiry.id,
        accountId: inquiry.accountId,
        source: match.source,
        method: match.method,
        tier: match.tier,
        confidence: match.confidence,
        approximate: match.approximate,
        score: match.score,
        distanceMeters: match.distanceMeters,
        listVersion: match.listVersion,
        matchedValue: match.matchedValue,
      })),
    );
    const stagedEvents: StagedEvent[] = [];
    for (const match of written) {
      const kind = kinds.get(match.listId);
      if (kind !== undefined) {
        stagedEvents.push(
          await events.stage(tx, {
            environmentId: inquiry.environmentId,
            name: 'list-match.created',
            payload: listMatchEventPayload(match, kind),
          }),
        );
      }
    }
    return stagedEvents;
  });
  await events.dispatch(staged);
}

/** C99.9: the lookup over the opted-in lists. */
export function createCompromisedIdLookup(deps: CompromisedIdLookupDeps): CompromisedIdLookup {
  return {
    async lookup({ environmentId, inquiryId, identificationNumber, idClass }) {
      const lists = await listCompromisedIdLists(deps.db, environmentId);
      if (lists.length === 0) {
        return null;
      }
      const inquiry = await getInquiry(deps.db, environmentId, inquiryId);
      if (inquiry?.redactedAt !== null) {
        return null;
      }
      const outcome = await matchLists(
        deps.db,
        environmentId,
        [
          {
            source: 'government-id.identification-number',
            kind: 'government-id-number',
            values: [
              {
                'id-number': identificationNumber,
                ...(idClass === null ? {} : { 'id-class': idClass }),
              },
            ],
          },
        ],
        { key: deps.blindIndexKey, lists },
      );
      if (outcome.matches.length > 0) {
        await recordMatches(deps, inquiry, outcome.matches, lists);
      }
      const unread = new Set(outcome.unscreened.map((entry) => entry['list-id']));
      const answer: ScreenedCompromisedIdAnswer = {
        matched: outcome.matches.length > 0,
        unscreened: outcome.unscreened,
        screened: lists.map(({ id }) => id).filter((id) => !unread.has(id)),
      };
      return answer;
    },
  };
}
