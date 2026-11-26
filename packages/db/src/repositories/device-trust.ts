/**
 * C127.9 (Workflow 8A): the device trust mark. Owner: `api-actions`. The mark is read by workflow
 * conditions alone: no signal or check reads it, and device retention clears it with the row.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { devices } from '../schema.js';
import { getDevice, type Device } from './devices.js';

export interface DeviceTrustMark {
  trustedAt: Date;
  trustedByType: NonNullable<Device['trustedByType']>;
  trustedById: string;
  trustReason: string;
}

/** Sets the mark, or clears all of it with `null`. Answers the device, `null` when it is absent. */
export async function setDeviceTrust(
  tx: Db,
  environmentId: string,
  deviceId: string,
  mark: DeviceTrustMark | null,
): Promise<Device | null> {
  const rows = await tx
    .update(devices)
    .set({
      trustedAt: mark?.trustedAt ?? null,
      trustedByType: mark?.trustedByType ?? null,
      trustedById: mark?.trustedById ?? null,
      trustReason: mark?.trustReason ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(devices.environmentId, environmentId), eq(devices.id, deviceId)))
    .returning({ id: devices.id });
  return rows.length === 0 ? null : getDevice(tx, environmentId, deviceId);
}
