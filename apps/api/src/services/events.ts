/**
 * Events (C5, C12, C14, C16): `GET /api/v1/events/:id` serves the same document webhooks
 * deliver, and `GET /api/v1/events` lists them. Payloads are served as stored: the event's
 * resource, or the stub that replaced it once its subject was redacted. Users without
 * `pii:view` get the payload's resources masked like the routes that serve them (C15).
 */
import {
  buildEventResource,
  eventNameSchema,
  filterValues,
  idSchema,
  isEventName,
  storedEventPayloadSchema,
  type EventDocument,
  type EventResource,
  type ListEventsQuery,
  type StoredEventPayload,
} from '@openverify/contracts';
import { getEvent, listEvents as findEvents, type EventRecord as EventRow } from '@openverify/db';
import { piiMaskFor, type PiiMask } from '../auth/pii.js';
import { NotFoundError } from '../errors.js';
import type { Principal } from '../ports.js';
import { caseIdsIn, filterCaseVisibility } from './cases/visibility.js';
import type { ApiDependencies } from './context.js';
import { nextLink, pageRequest, withCursor } from './pagination.js';

export const EVENTS_PATH = '/api/v1/events';

interface ResourceObject {
  attributes: Readonly<Record<string, unknown>>;
}

const masked = <R extends ResourceObject>(resource: R, mask: PiiMask): R => ({
  ...resource,
  attributes: mask.attributes(resource.attributes),
});

/** The payload with its resources' PII masked for `mask`; stubs have none to mask. */
function maskPayload(payload: StoredEventPayload, mask: PiiMask): StoredEventPayload {
  if (mask.visible) {
    return payload;
  }
  const { data, ...rest } = payload as { data: ResourceObject; included?: ResourceObject[] };
  return {
    ...rest,
    data: masked(data, mask),
    ...(rest.included === undefined
      ? {}
      : { included: rest.included.map((resource) => masked(resource, mask)) }),
  } as StoredEventPayload;
}

/**
 * The event resource, with C14 `simulated`.
 * @throws {Error} for a stored event outside the event contract (an unknown name, or a payload
 *   that is neither a C5 payload nor a C16 stub), so it fails loudly rather than reach a client.
 */
export function eventResource(row: EventRow, mask: PiiMask): EventResource {
  if (!isEventName(row.name)) {
    throw new Error(`Event ${row.id} has a name outside the event contract`);
  }
  return buildEventResource({
    id: row.id,
    name: row.name,
    payload: maskPayload(storedEventPayloadSchema.parse(row.payload), mask),
    simulated: row.simulated,
    createdAt: row.createdAt,
  });
}

/** @throws {NotFoundError} when the event is not in the principal's environment. */
const readerOf = (principal: Principal) => ({ environmentId: principal.environmentId, principal });

/** The cases an event names: its object, and any case or comment its payload holds. */
const eventCaseIds = (event: { objectId: string | null; payload: unknown }) =>
  caseIdsIn(event.objectId, event.payload);

export async function getEventDocument(
  { db }: ApiDependencies,
  principal: Principal,
  id: string,
): Promise<EventDocument> {
  const event = await getEvent(db, principal.environmentId, id);
  // C129.4 (V08; Workflow 8B): an event of a case the reader may not see reads as missing.
  const [visible] =
    event === null ? [] : await filterCaseVisibility(db, readerOf(principal), [event], eventCaseIds);
  if (visible === undefined) {
    throw new NotFoundError(`Event ${id} was not found.`);
  }
  return { data: eventResource(visible, piiMaskFor(principal)) };
}

/** The C9 `created-at` range every list query takes (the inferred query type drops it). */
interface CreatedAtQuery {
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
}

const timestamp = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value);

/**
 * C12 `GET /events`: newest first, by name (comma list), payload object, creation time and
 * `simulated`, which defaults to `false` so simulated deliveries stay out of real history; and
 * (C25.7) by inquiry: events about the inquiry, its verifications or its inquiry sessions, in the
 * caller's environment only.
 */
export async function listEvents(
  { db }: ApiDependencies,
  principal: Principal,
  query: ListEventsQuery & CreatedAtQuery,
): Promise<{ data: EventResource[]; links: { next: string | null } }> {
  const page = await withCursor(() =>
    findEvents(db, principal.environmentId, {
      ...pageRequest(query),
      name: filterValues(query['filter[name]'], eventNameSchema),
      objectId: query['filter[object-id]'],
      inquiryId: filterValues(query['filter[inquiry-id]'], idSchema('inq')),
      simulated: query['filter[simulated]'] === 'true',
      createdAtStart: timestamp(query['filter[created-at-start]']),
      createdAtEnd: timestamp(query['filter[created-at-end]']),
    }),
  );
  const mask = piiMaskFor(principal);
  const filters = {
    'filter[name]': query['filter[name]'],
    'filter[object-id]': query['filter[object-id]'],
    'filter[inquiry-id]': query['filter[inquiry-id]'],
    'filter[simulated]': query['filter[simulated]'],
    'filter[created-at-start]': query['filter[created-at-start]'],
    'filter[created-at-end]': query['filter[created-at-end]'],
  };
  // C129.4 (V08; Workflow 8B): a page can come back short, and `links.next` still moves on.
  const visible = await filterCaseVisibility(db, readerOf(principal), page.items, eventCaseIds);
  return {
    data: visible.map((row) => eventResource(row, mask)),
    links: { next: nextLink(EVENTS_PATH, filters, query, page.next) },
  };
}
