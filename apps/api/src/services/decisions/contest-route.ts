/**
 * C128.7 (P40, a C3 amendment): how the person contests a decline, for the flow session's answer: the
 * route of the inquiry's newest decline, with a URL's host shown before the link. A case template is
 * the operator's, and stays out of it.
 */
import {
  contestRouteSchema,
  flowDecisionContestRouteSchema,
  type FlowDecisionContestRoute,
} from '@openverify/contracts';
import { listDecisionsForSubjects, type Db } from '@openverify/db';

/** The route of the inquiry's newest decline; `null` when it holds none. */
export async function flowDecisionContestRouteOf(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<FlowDecisionContestRoute | null> {
  const decisions = await listDecisionsForSubjects(db, environmentId, [inquiryId]);
  const decline = decisions.find(({ kind }) => kind === 'decline');
  if (decline?.contestRoute == null) {
    return null;
  }
  const { url, contact } = contestRouteSchema.parse(decline.contestRoute);
  return flowDecisionContestRouteSchema.parse({
    url: url ?? null,
    host: url === undefined ? null : new URL(url).host,
    contact: contact ?? null,
  });
}
