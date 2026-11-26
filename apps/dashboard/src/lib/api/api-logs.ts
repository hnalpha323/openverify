/**
 * API logs (C12) as the API logs page lists them: filtered by method, status code or class,
 * route, API key, dashboard user (C25.9) and creation range, with the filters and the cursor in
 * the page URL (C23).
 */
import 'server-only';
import { idSchema } from '@openverify/contracts';
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

export const API_LOG_PAGE_SIZE = 25;

/** The methods the server API answers. */
export const API_LOG_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

export type ApiLogFilterName =
  'method' | 'status' | 'route' | 'api-key-id' | 'user-id' | 'created-at-start' | 'created-at-end';

export interface ApiLogListQuery extends ReadFilters<ApiLogFilterName> {
  /** The last entry of the previous page. */
  readonly after?: string;
}

const isApiKeyId = (value: string) => idSchema('key').safeParse(value).success;
const isUserId = (value: string) => idSchema('usr').safeParse(value).success;

/**
 * The API logs filter of the page URL: `?method=POST&status=4xx&route=/api/v1/inquiries/:id`,
 * `api-key-id`, `user-id`, and the creation range as `datetime-local` values in UTC.
 */
export function parseApiLogListQuery(params: SearchParams): ApiLogListQuery {
  const after = parseCursor(params.after, 'alog');
  return {
    ...readFilters(params, {
      method: oneOf(API_LOG_METHODS, 'Choose a method from the list.'),
      status: matching(
        /^[1-5](?:[0-9]{2}|xx)$/,
        'Enter a status code such as 404, or a class such as 4xx.',
      ),
      route: matching(
        /^\/\S{0,511}$/,
        'Enter a route template that starts with /, such as /api/v1/inquiries/:id.',
      ),
      'api-key-id': matching(
        isApiKeyId,
        'Enter an API key ID, such as key_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
      ),
      // C25.9: the requests made with this user's dashboard sessions.
      'user-id': matching(isUserId, 'Enter a user ID, such as usr_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.'),
      'created-at-start': utcTime,
      'created-at-end': utcTime,
    }),
    ...(after === undefined ? {} : { after }),
  };
}

/** One page of API log entries, newest first. */
export function listApiLogs(api: OpenVerifyClient, query: ApiLogListQuery) {
  return api.apiLogs.list({
    filter: query.applied,
    page: { size: API_LOG_PAGE_SIZE, ...(query.after === undefined ? {} : { after: query.after }) },
  });
}
