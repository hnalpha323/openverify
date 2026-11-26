/**
 * C127.9: Trust Device, from `POST /devices/:id/trust` and from `trust_device`. The mark is served on
 * the device and read by workflow conditions alone: no signal or check reads it, and device retention
 * clears it with the row. Both moves are audit-logged, with a code for the reason and nothing else.
 */
import type { DeviceResource, TrustDeviceBody } from '@openverify/contracts';
import { setDeviceTrust, type Db, type Device } from '@openverify/db';
import { NotFoundError } from '../../../errors.js';
import type { ApiDependencies } from '../../../services/context.js';
import { auditEntryOf } from '../../../services/context.js';
import { deviceResource } from '../../../services/inquiry-sessions.js';
import type { Acting } from '../../../services/inquiries.js';

export interface DeviceTrustChange {
  'trust-reason'?: string | undefined;
  untrust?: true | undefined;
}

/** In the caller's transaction, for the step's effect (C117.5). */
export async function trustDeviceInTx(
  tx: Db,
  deps: Pick<ApiDependencies, 'audit' | 'clock'>,
  acting: Pick<Acting, 'ctx' | 'actor'>,
  id: string,
  change: DeviceTrustChange,
): Promise<Device> {
  const reason = change.untrust === true ? undefined : change['trust-reason'];
  const device = await setDeviceTrust(
    tx,
    acting.ctx.environmentId,
    id,
    reason === undefined
      ? null
      : {
          trustedAt: deps.clock.now(),
          trustedByType: acting.actor.type,
          trustedById: acting.actor.id,
          trustReason: reason,
        },
  );
  if (device === null) {
    throw new NotFoundError(`Device ${id} was not found.`);
  }
  await deps.audit.record(
    tx,
    auditEntryOf(acting.ctx, acting.actor, {
      action: reason === undefined ? 'device.untrusted' : 'device.trusted',
      resourceType: 'device',
      resourceId: id,
      ...(reason === undefined ? {} : { metadata: { 'trust-reason': reason } }),
    }),
  );
  return device;
}

export async function trustDevice(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  meta: TrustDeviceBody['meta'],
): Promise<DeviceResource> {
  const device = await deps.db.transaction((tx) => trustDeviceInTx(tx, deps, acting, id, meta));
  return deviceResource(device, acting.mask);
}
