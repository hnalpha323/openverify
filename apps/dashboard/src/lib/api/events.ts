/**
 * Events (C5, C12, C17) as the events page lists them: filtered by name, object, creation range
 * and whether they were simulated, with the filters and the cursor in the page URL (C23).
 */
import 'server-only';
import {
  ACCOUNT_EVENT_NAMES,
  CASE_COMMENT_EVENT_NAMES,
  CASE_EVENT_NAMES,
  CASE_TEMPLATE_EVENT_NAMES,
  CONNECT_EVENT_NAMES,
  DEPLOYMENT_EVENT_NAMES,
  INQUIRY_TEMPLATE_VERSION_EVENT_NAMES,
  GRAPH_QUERY_EVENT_NAMES,
  LIST_EVENT_NAMES,
  LIST_MATCH_EVENT_NAMES,
  REPORT_EVENT_NAMES,
  TRANSACTION_EVENT_NAMES,
  TRANSACTION_TYPE_EVENT_NAMES,
  SELFIE_EVENT_NAMES,
  WORKFLOW_EVENT_NAMES,
  WORKFLOW_RUN_EVENT_NAMES,
  WORKFLOW_VERSION_EVENT_NAMES,
  EVENT_NAMES,
  INQUIRY_EVENT_NAMES,
  INQUIRY_SESSION_EVENT_NAMES,
  VERIFICATION_EVENT_NAMES,
  anyIdSchema,
} from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import {
  matching,
  oneOf,
  readFilters,
  utcTime,
  type ReadFilters,
  type SearchParams,
} from '../../components/integrations/filter-values';
import { parseCursor } from '../list-query';

export const EVENT_PAGE_SIZE = 25;

export type EventFilterName =
  'name' | 'object-id' | 'simulated' | 'created-at-start' | 'created-at-end';

export interface EventListQuery extends ReadFilters<EventFilterName> {
  /** The last event of the previous page. */
  readonly after?: string;
}

const isObjectId = (value: string) => anyIdSchema.safeParse(value).success;

/**
 * The events filter of the page URL: `?name=inquiry.approved&object-id=inq_…&simulated=true`,
 * with the creation range as `datetime-local` values in UTC.
 */
export function parseEventListQuery(params: SearchParams): EventListQuery {
  const after = parseCursor(params.after, 'evt');
  return {
    ...readFilters(params, {
      name: oneOf(EVENT_NAMES, 'Choose an event from the list.'),
      'object-id': matching(
        isObjectId,
        'Enter an object ID, such as inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
      ),
      // The API lists real events by default (`filter[simulated]=false`).
      simulated: oneOf(['true'], 'Choose from the list.'),
      'created-at-start': utcTime,
      'created-at-end': utcTime,
    }),
    ...(after === undefined ? {} : { after }),
  };
}

/** One page of events, newest first. */
export function listEvents(api: OpenVerifyClient, query: EventListQuery) {
  const { simulated, ...filter } = query.applied;
  return api.events.list({
    filter: { ...filter, ...(simulated === undefined ? {} : { simulated: true }) },
    page: { size: EVENT_PAGE_SIZE, ...(query.after === undefined ? {} : { after: query.after }) },
  });
}

export interface EventNameGroup {
  readonly label: string;
  readonly names: readonly string[];
}

/** Every event name, grouped by the resource its payload carries (C17), for pickers. */
export function eventNameGroups(): readonly EventNameGroup[] {
  return [
    { label: 'Inquiry', names: INQUIRY_EVENT_NAMES },
    { label: 'Inquiry session', names: INQUIRY_SESSION_EVENT_NAMES },
    { label: 'Verification', names: VERIFICATION_EVENT_NAMES },
    { label: 'Account', names: ACCOUNT_EVENT_NAMES },
    // C40.8 (Phase 4): the selfie capture events.
    { label: 'Selfie', names: SELFIE_EVENT_NAMES },
    // C70.4 (Phase 6): every report type's events, said in words by `eventWords` (C86).
    { label: 'Report', names: REPORT_EVENT_NAMES },
    // C107.4 (Workflow 7B): "List matches".
    { label: 'List matches', names: LIST_MATCH_EVENT_NAMES },
    { label: 'Transactions', names: TRANSACTION_EVENT_NAMES },
    { label: 'Transaction types', names: TRANSACTION_TYPE_EVENT_NAMES },
    { label: 'Graph queries', names: GRAPH_QUERY_EVENT_NAMES },
    // C143.4 (Workflow 8A).
    { label: 'Workflows', names: [...WORKFLOW_EVENT_NAMES, ...WORKFLOW_VERSION_EVENT_NAMES] },
    { label: 'Workflow runs', names: WORKFLOW_RUN_EVENT_NAMES },
    { label: 'Lists', names: LIST_EVENT_NAMES },
    // C129.6 (Workflow 8B).
    { label: 'Cases', names: [...CASE_EVENT_NAMES, ...CASE_TEMPLATE_EVENT_NAMES] },
    { label: 'Case comments', names: CASE_COMMENT_EVENT_NAMES },
    // C154.8 (Workflow 9A).
    { label: 'Inquiry templates', names: INQUIRY_TEMPLATE_VERSION_EVENT_NAMES },
    { label: 'Deployments', names: DEPLOYMENT_EVENT_NAMES },
    // C239.3 (Workflow 11A): connections, share tokens and consent records.
    { label: 'Connect', names: CONNECT_EVENT_NAMES },
  ];
}
