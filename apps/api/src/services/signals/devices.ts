/**
 * C91.2 (Workflow 7A): the device routes' service. Owner: `api-signals`; the signatures are frozen
 * by `foundation-7a` (Stage 1b (S)) with the routes (`routes/server/devices.ts`).
 *
 * - `GET /api/v1/devices?filter[inquiry-session-id]=<iqse_…>`: the filter is required (400
 *   `filter_required` without it); the session's device, newest first, masked without `pii:view`.
 * - `GET /api/v1/devices/:id`.
 */
import type { DeviceListDocument, DeviceResource, ListDevicesQuery } from '@openverify/contracts';
import { getDevice, listSessionDevices } from '@openverify/db';
import { NotFoundError, SignalProblemError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import type { Acting } from '../inquiries.js';
import { deviceResource } from '../inquiry-sessions.js';

/**
 * C91.2: the session's device (a session links to at most one, so there is one page). A session of
 * another environment lists nothing.
 * @throws {SignalProblemError} 400 `filter_required` without `filter[inquiry-session-id]`.
 */
export async function listDevices(
  deps: ApiDependencies,
  acting: Pick<Acting, 'ctx' | 'mask'>,
  query: ListDevicesQuery,
): Promise<DeviceListDocument> {
  const sessionId = query['filter[inquiry-session-id]'];
  if (sessionId === undefined) {
    throw new SignalProblemError(
      'filter_required',
      'Devices are listed per inquiry session: give filter[inquiry-session-id].',
    );
  }
  const linked = await listSessionDevices(deps.db, acting.ctx.environmentId, [sessionId]);
  return {
    data: linked.map(({ device }) => deviceResource(device, acting.mask)),
    links: { next: null },
  };
}

/**
 * C91.2: the environment's device `id`.
 * @throws {NotFoundError} when it is not in this environment.
 */
export async function getDeviceResource(
  deps: ApiDependencies,
  acting: Pick<Acting, 'ctx' | 'mask'>,
  id: string,
): Promise<DeviceResource> {
  const device = await getDevice(deps.db, acting.ctx.environmentId, id);
  if (device === null) {
    throw new NotFoundError(`Device ${id} was not found.`);
  }
  return deviceResource(device, acting.mask);
}
