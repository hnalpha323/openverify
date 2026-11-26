/**
 * C91.2, C94.4 (Workflow 7A): devices and the session links. Owner: `api-signals`, which builds
 * the writes and the rebuild; the signatures are frozen by `foundation-7a` (Stage 1b (S)).
 *
 * A device exists only when the device-recognition tier recorded an identifier. Its HMACs come
 * from `identifierKey` under the environment's blind-index subkey with the key id
 * (`blindIndexKeyId`) they were made under; a session links to at most one device.
 */
import type { DecisionActorType } from '@openverify/core';
import { and, asc, eq, gt, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { blindIndexKeyId, identifierKey } from '../blind-index.js';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  devices,
  inquirySessions,
  inquirySessionSignals,
  sessionDevices,
  sessionSignalRowKey,
} from '../schema.js';
import { openJson } from '../sealed.js';
import type { RebuildIndexesResult } from './government-id-extractions.js';

/** A device as the repositories return it. The HMACs are plain (C94.4). */
export interface Device {
  id: string;
  environmentId: string;
  platform: 'web' | 'android';
  collectorVersion: number;
  /** The strict browser HMAC; web only, `null` with a randomised canvas. */
  browserFingerprint: string | null;
  /** The `ANDROID_ID` HMAC; Android only (V10). */
  deviceFingerprint: string | null;
  /** Ours: the web device-class HMAC, shared by many people; never a list probe. */
  deviceClass: string | null;
  fingerprintRandomised: boolean;
  keyId: string;
  /** Sessions linked to the device now. */
  sessionCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** C127.9: the trust mark, whole or all `null`. Read by workflow conditions alone. */
  trustedAt: Date | null;
  trustedByType: DecisionActorType | null;
  trustedById: string | null;
  trustReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What `linkSessionDevice` writes for a session whose recognition tier recorded identifiers. */
export interface SessionDeviceWrite {
  /** The new device's id, used only when no device of these identifiers exists. */
  deviceId: string;
  inquirySessionId: string;
  platform: 'web' | 'android';
  collectorVersion: number;
  browserFingerprint: string | null;
  deviceFingerprint: string | null;
  deviceClass: string | null;
  fingerprintRandomised: boolean;
  keyId: string;
  at: Date;
}

/**
 * C91.2: finds the environment's device of these identifiers under this key id, or creates it,
 * links the session to it (once: a session keeps its first device) and moves `last_seen_at`, in
 * `tx`. Returns the device.
 */
export async function linkSessionDevice(
  tx: Db,
  environmentId: string,
  write: SessionDeviceWrite,
): Promise<Device> {
  const [linked] = await tx
    .select({ deviceId: sessionDevices.deviceId })
    .from(sessionDevices)
    .where(
      and(
        eq(sessionDevices.environmentId, environmentId),
        eq(sessionDevices.inquirySessionId, write.inquirySessionId),
      ),
    );
  const deviceId = linked?.deviceId ?? (await findOrCreateDevice(tx, environmentId, write));
  await tx
    .insert(sessionDevices)
    .values({
      environmentId,
      inquirySessionId: write.inquirySessionId,
      deviceId,
      createdAt: write.at,
    })
    .onConflictDoNothing();
  await tx
    .update(devices)
    .set({
      lastSeenAt: sql`greatest(${devices.lastSeenAt}, ${write.at.toISOString()}::timestamptz)`,
    })
    .where(and(eq(devices.environmentId, environmentId), eq(devices.id, deviceId)));
  const device = await getDevice(tx, environmentId, deviceId);
  if (device === null) {
    throw new Error('The linked device is missing.');
  }
  return device;
}

/** The environment's device of these identifiers under this key id, created when there is none. */
async function findOrCreateDevice(
  tx: Db,
  environmentId: string,
  write: SessionDeviceWrite,
): Promise<string> {
  const byIdentifier = identifierOf(environmentId, write);
  if (byIdentifier !== null) {
    const [found] = await tx.select({ id: devices.id }).from(devices).where(byIdentifier);
    if (found !== undefined) {
      return found.id;
    }
  }
  const inserted = await tx
    .insert(devices)
    .values({
      id: write.deviceId,
      environmentId,
      platform: write.platform,
      collectorVersion: write.collectorVersion,
      browserFingerprint: write.browserFingerprint,
      deviceFingerprint: write.deviceFingerprint,
      deviceClass: write.deviceClass,
      fingerprintRandomised: write.fingerprintRandomised,
      keyId: write.keyId,
      firstSeenAt: write.at,
      lastSeenAt: write.at,
    })
    .onConflictDoNothing()
    .returning({ id: devices.id });
  if (inserted[0] !== undefined) {
    return inserted[0].id;
  }
  // A concurrent session created the same device first.
  const [raced] =
    byIdentifier === null
      ? []
      : await tx.select({ id: devices.id }).from(devices).where(byIdentifier);
  if (raced === undefined) {
    throw new Error('The device could not be created.');
  }
  return raced.id;
}

/**
 * The unique identifier a device is found by: the strict HMAC on web, the `ANDROID_ID` HMAC on
 * Android, each under its key id; `null` for a randomised web session, whose device class alone
 * names a model shared by many people, so each such session gets a device of its own.
 */
function identifierOf(
  environmentId: string,
  write: Pick<SessionDeviceWrite, 'browserFingerprint' | 'deviceFingerprint' | 'keyId'>,
) {
  const inEnvironment = and(
    eq(devices.environmentId, environmentId),
    eq(devices.keyId, write.keyId),
  );
  if (write.browserFingerprint !== null) {
    return and(inEnvironment, eq(devices.browserFingerprint, write.browserFingerprint));
  }
  if (write.deviceFingerprint !== null) {
    return and(inEnvironment, eq(devices.deviceFingerprint, write.deviceFingerprint));
  }
  return null;
}

/**
 * C94.4: recomputes every device HMAC under the current blind-index key from the sealed
 * components still retained, and records the new key id; devices whose components are gone keep
 * their old key id. Counts only.
 */
export async function rebuildDeviceIndexes(
  db: Db,
  key: Uint8Array,
  options: { batchSize?: number } = {},
): Promise<RebuildIndexesResult> {
  const batchSize = options.batchSize ?? 500;
  let scanned = 0;
  let updated = 0;
  let after: { environmentId: string; id: string } | null = null;
  for (;;) {
    const batch: {
      environmentId: string;
      id: string;
      platform: 'web' | 'android';
      browserFingerprint: string | null;
      deviceFingerprint: string | null;
      deviceClass: string | null;
      keyId: string;
    }[] = await db
      .select({
        environmentId: devices.environmentId,
        id: devices.id,
        platform: devices.platform,
        browserFingerprint: devices.browserFingerprint,
        deviceFingerprint: devices.deviceFingerprint,
        deviceClass: devices.deviceClass,
        keyId: devices.keyId,
      })
      .from(devices)
      .where(
        after === null
          ? undefined
          : or(
              gt(devices.environmentId, after.environmentId),
              and(eq(devices.environmentId, after.environmentId), gt(devices.id, after.id)),
            ),
      )
      .orderBy(asc(devices.environmentId), asc(devices.id))
      .limit(batchSize);
    if (batch.length === 0) {
      return { scanned, updated };
    }
    for (const device of batch) {
      scanned += 1;
      const inputs = await retainedInputs(db, device.environmentId, device.id, device.platform);
      if (inputs === null) {
        continue;
      }
      const next = deviceHmacs(key, device.environmentId, inputs);
      if (
        next.keyId === device.keyId &&
        next.browserFingerprint === device.browserFingerprint &&
        next.deviceFingerprint === device.deviceFingerprint &&
        next.deviceClass === device.deviceClass
      ) {
        continue;
      }
      await db.transaction((tx) => rekeyDevice(tx, device.environmentId, device.id, next));
      updated += 1;
    }
    const last = batch[batch.length - 1];
    after = last === undefined ? null : { environmentId: last.environmentId, id: last.id };
  }
}

/** The identifier inputs of the device's first retained recognition body, or `null`. */
async function retainedInputs(
  db: Db,
  environmentId: string,
  deviceId: string,
  platform: 'web' | 'android',
): Promise<DeviceIdentifierInputs | null> {
  const bodies = await db
    .select({
      inquirySessionId: inquirySessionSignals.inquirySessionId,
      sequence: inquirySessionSignals.sequence,
      components: inquirySessionSignals.componentsSealed,
    })
    .from(sessionDevices)
    .innerJoin(
      inquirySessionSignals,
      and(
        eq(inquirySessionSignals.environmentId, sessionDevices.environmentId),
        eq(inquirySessionSignals.inquirySessionId, sessionDevices.inquirySessionId),
      ),
    )
    .where(
      and(
        eq(sessionDevices.environmentId, environmentId),
        eq(sessionDevices.deviceId, deviceId),
        eq(inquirySessionSignals.platform, platform),
        isNotNull(inquirySessionSignals.componentsSealed),
      ),
    )
    .orderBy(asc(inquirySessionSignals.createdAt), asc(inquirySessionSignals.sequence));
  for (const body of bodies) {
    if (body.components === null) {
      continue;
    }
    const components = openJson(
      SEALED.sessionSignalComponents,
      sessionSignalRowKey(body.inquirySessionId, body.sequence),
      body.components,
    ) as Record<string, unknown>;
    const inputs = deviceIdentifierInputs(platform, components);
    if (inputs !== null) {
      return inputs;
    }
  }
  return null;
}

/**
 * Gives the device its new HMACs and key id. When another device of the environment already holds
 * the new identifier (two devices made under different keys), the sessions move to that device and
 * this one is deleted, so one device remains per identifier. The survivor keeps a trust mark held by
 * either, its own first (C127.9, outcome 17): a key rotation never drops an operator's mark.
 */
async function rekeyDevice(
  tx: Db,
  environmentId: string,
  deviceId: string,
  next: ReturnType<typeof deviceHmacs>,
): Promise<void> {
  const byIdentifier = identifierOf(environmentId, next);
  const [other] =
    byIdentifier === null
      ? []
      : await tx
          .select({ id: devices.id })
          .from(devices)
          .where(and(byIdentifier, ne(devices.id, deviceId)));
  if (other === undefined) {
    await tx
      .update(devices)
      .set(next)
      .where(and(eq(devices.environmentId, environmentId), eq(devices.id, deviceId)));
    return;
  }
  await tx
    .update(sessionDevices)
    .set({ deviceId: other.id })
    .where(
      and(eq(sessionDevices.environmentId, environmentId), eq(sessionDevices.deviceId, deviceId)),
    );
  await tx.execute(sql`
    update devices as target
       set first_seen_at = least(target.first_seen_at, source.first_seen_at),
           last_seen_at = greatest(target.last_seen_at, source.last_seen_at),
           trusted_by_type = case when target.trusted_at is null then source.trusted_by_type
                                  else target.trusted_by_type end,
           trusted_by_id = case when target.trusted_at is null then source.trusted_by_id
                                else target.trusted_by_id end,
           trust_reason = case when target.trusted_at is null then source.trust_reason
                               else target.trust_reason end,
           trusted_at = coalesce(target.trusted_at, source.trusted_at)
      from devices as source
     where target.environment_id = ${environmentId} and target.id = ${other.id}
       and source.environment_id = ${environmentId} and source.id = ${deviceId}`);
  await tx
    .delete(devices)
    .where(and(eq(devices.environmentId, environmentId), eq(devices.id, deviceId)));
}

/** C91.1, C94.5: the session's parsed device fields, each at most 64 characters or `null`. */
export interface SessionDeviceFields {
  osName: string | null;
  osFullVersion: string | null;
  browserName: string | null;
  browserFullVersion: string | null;
  deviceType: 'desktop' | 'smartphone' | 'tablet' | 'tv' | null;
  deviceName: string | null;
  mobileSdkName: 'openverify-android' | 'openverify-ios' | null;
  mobileSdkFullVersion: string | null;
}

/**
 * C93.2, C94.5: writes the session's parsed device fields in `tx`.
 */
export async function recordSessionDeviceFields(
  tx: Db,
  environmentId: string,
  inquirySessionId: string,
  fields: SessionDeviceFields,
): Promise<void> {
  await tx
    .update(inquirySessions)
    .set(fields)
    .where(
      and(
        eq(inquirySessions.environmentId, environmentId),
        eq(inquirySessions.id, inquirySessionId),
      ),
    );
}

/**
 * C91.1, C94.5: an SDK session's `device-type` from the `device-class` of its first Android body:
 * set only on a session with `mobile-sdk-name` and no device type yet. Returns whether it was set.
 */
export async function recordSdkSessionDeviceType(
  tx: Db,
  environmentId: string,
  inquirySessionId: string,
  deviceType: 'smartphone' | 'tablet',
): Promise<boolean> {
  const set = await tx
    .update(inquirySessions)
    .set({ deviceType })
    .where(
      and(
        eq(inquirySessions.environmentId, environmentId),
        eq(inquirySessions.id, inquirySessionId),
        isNotNull(inquirySessions.mobileSdkName),
        sql`${inquirySessions.deviceType} is null`,
      ),
    )
    .returning({ id: inquirySessions.id });
  return set.length > 0;
}

/** The canonical texts a device's HMACs are made from (C94.4), `null` where there is none. */
export interface DeviceIdentifierInputs {
  browserFingerprint: string | null;
  deviceClass: string | null;
  androidId: string | null;
  fingerprintRandomised: boolean;
}

/**
 * C94.4: the canonical identifier texts of a stored body's `components` (its `recognition` or
 * `android-recognition` member), shared by the write path and `rebuildDeviceIndexes`; `null` when
 * the components hold no recognition member.
 */
export function deviceIdentifierInputs(
  platform: 'web' | 'android',
  components: Record<string, unknown> | null,
): DeviceIdentifierInputs | null {
  if (platform === 'android') {
    const recognition = objectOf(components?.['android-recognition']);
    const androidId = recognition?.['android-id'];
    return typeof androidId === 'string'
      ? {
          browserFingerprint: null,
          deviceClass: null,
          androidId: androidId.toLowerCase(),
          fingerprintRandomised: false,
        }
      : null;
  }
  const recognition = objectOf(components?.recognition);
  if (recognition === null) {
    return null;
  }
  const randomised = recognition['canvas-noise'] === true;
  const value = (name: string): unknown => recognition[name] ?? null;
  const deviceClass = {
    platform: 'web',
    screen: value('screen'),
    'hardware-concurrency': value('hardware-concurrency'),
    'device-memory': value('device-memory'),
    'max-touch-points': value('max-touch-points'),
    'webgl-vendor': value('webgl-vendor'),
    'webgl-renderer': value('webgl-renderer'),
  };
  return {
    browserFingerprint: randomised
      ? null
      : canonicalJson({ ...deviceClass, 'canvas-digest': value('canvas-digest') }),
    deviceClass: canonicalJson(deviceClass),
    androidId: null,
    fingerprintRandomised: randomised,
  };
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** JSON with every object's keys sorted, so the same components always give the same text. */
function canonicalJson(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(sorted);
    }
    const object = objectOf(item);
    if (object === null) {
      return item;
    }
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, sorted(object[key])]),
    );
  };
  return JSON.stringify(sorted(value));
}

/**
 * C94.4: the device's HMACs under `key` from its inputs, in the environment `environmentId`.
 * Exported for the write path (`api-signals`), so the write and the rebuild agree.
 */
export function deviceHmacs(
  key: Uint8Array,
  environmentId: string,
  inputs: DeviceIdentifierInputs,
): Pick<SessionDeviceWrite, 'browserFingerprint' | 'deviceFingerprint' | 'deviceClass' | 'keyId'> {
  const hmac = (
    kind: 'browser-fingerprint' | 'device-class' | 'android-id',
    input: string | null,
  ) => (input === null ? null : identifierKey(key, { environmentId, kind, input }));
  return {
    browserFingerprint: hmac('browser-fingerprint', inputs.browserFingerprint),
    deviceFingerprint: hmac('android-id', inputs.androidId),
    deviceClass: hmac('device-class', inputs.deviceClass),
    keyId: blindIndexKeyId(key),
  };
}

const DEVICE_COLUMNS = {
  id: devices.id,
  environmentId: devices.environmentId,
  platform: devices.platform,
  collectorVersion: devices.collectorVersion,
  browserFingerprint: devices.browserFingerprint,
  deviceFingerprint: devices.deviceFingerprint,
  deviceClass: devices.deviceClass,
  fingerprintRandomised: devices.fingerprintRandomised,
  keyId: devices.keyId,
  sessionCount: sql<number>`(select count(*)::int from ${sessionDevices}
    where ${sessionDevices.environmentId} = ${devices.environmentId}
      and ${sessionDevices.deviceId} = ${devices.id})`,
  firstSeenAt: devices.firstSeenAt,
  lastSeenAt: devices.lastSeenAt,
  trustedAt: devices.trustedAt,
  trustedByType: devices.trustedByType,
  trustedById: devices.trustedById,
  trustReason: devices.trustReason,
  createdAt: devices.createdAt,
  updatedAt: devices.updatedAt,
};

/**
 * C91.1, C91.2: the device of each of `sessionIds` that has one (for `?include=device` and the
 * session events), with its session count. Built by `foundation-7a` (Stage 1b (S)) for the session
 * reads; `api-signals` owns the file.
 */
export async function listSessionDevices(
  db: Db,
  environmentId: string,
  sessionIds: readonly string[],
): Promise<{ inquirySessionId: string; device: Device }[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ inquirySessionId: sessionDevices.inquirySessionId, ...DEVICE_COLUMNS })
    .from(sessionDevices)
    .innerJoin(
      devices,
      and(
        eq(devices.environmentId, sessionDevices.environmentId),
        eq(devices.id, sessionDevices.deviceId),
      ),
    )
    .where(
      and(
        eq(sessionDevices.environmentId, environmentId),
        inArray(sessionDevices.inquirySessionId, [...sessionIds]),
      ),
    );
  return rows.map(({ inquirySessionId, ...device }) => ({ inquirySessionId, device }));
}

/** C91.2: the environment's device `id`, or `null`. */
export async function getDevice(db: Db, environmentId: string, id: string): Promise<Device | null> {
  const [row] = await db
    .select(DEVICE_COLUMNS)
    .from(devices)
    .where(and(eq(devices.environmentId, environmentId), eq(devices.id, id)))
    .limit(1);
  return row ?? null;
}
