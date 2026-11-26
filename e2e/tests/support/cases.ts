/**
 * Workflow 8B spec helpers (C146.3): a published case template of the spec's own, and a synthetic
 * JPEG carrying GPS EXIF, to show that a rendition drops it. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import type { OpenVerifyClient } from '@openverify/node';

/** A key no other spec holds: `E` and nine upper-case letters or digits (C130.1). */
export function caseTemplateKey(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return `E${[...randomBytes(9)].map((byte) => alphabet[byte % alphabet.length] ?? 'X').join('')}`;
}

/** A case template with the default statuses and every held type, published (C130.2). */
export async function publishedCaseTemplate(
  client: OpenVerifyClient,
  name: string,
): Promise<{ id: string; key: string }> {
  const key = caseTemplateKey();
  const { data: template } = await client.caseTemplates.create({ name, key });
  const draft = template.relationships['draft-version'].data;
  if (draft === null) {
    throw new Error(`case template ${template.id} has no draft version`);
  }
  await client.caseTemplateVersions.publish(draft.id);
  return { id: template.id, key };
}

const MARKER = 0xff;
const SOI = 0xd8;
const APP1 = 0xe1;
const SOS = 0xda;

/** The markers of a JPEG's segments before its scan data (each `0xFFxx` after SOI). */
export function jpegMarkers(bytes: Uint8Array): number[] {
  if (bytes[0] !== MARKER || bytes[1] !== SOI) {
    throw new Error('not a JPEG: no start-of-image marker');
  }
  const markers: number[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === MARKER) {
    const marker = bytes[offset + 1] ?? 0;
    markers.push(marker);
    if (marker === SOS) {
      break;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    offset += 2 + length;
  }
  return markers;
}

/** `0xFFE1`: an APP1 segment, where EXIF and XMP live. */
export const APP1_MARKER = APP1;

/**
 * `jpeg` with an APP1 EXIF segment after its start-of-image marker: IFD0 holds an ImageDescription
 * (`canary`) and a pointer to a GPS IFD holding GPSLatitudeRef `N`, big-endian, as a camera writes.
 */
export function withGpsExif(jpeg: Uint8Array, canary: string): Uint8Array {
  const description = Buffer.from(`${canary}\0`, 'ascii');
  // TIFF header (8) + IFD0: count (2), two entries (24), next IFD (4) = offset 38 for GPS IFD.
  const gpsOffset = 8 + 2 + 24 + 4;
  // GPS IFD: count (2), one entry (12), next IFD (4); the description follows it.
  const descriptionOffset = gpsOffset + 2 + 12 + 4;
  const tiff = Buffer.alloc(descriptionOffset + description.length);
  tiff.write('MM', 0, 'ascii');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(2, 8);
  // 0x010E ImageDescription, ASCII, its count, at its offset.
  tiff.writeUInt16BE(0x010e, 10);
  tiff.writeUInt16BE(2, 12);
  tiff.writeUInt32BE(description.length, 14);
  tiff.writeUInt32BE(descriptionOffset, 18);
  // 0x8825 GPSInfo, LONG, one, the GPS IFD's offset.
  tiff.writeUInt16BE(0x8825, 22);
  tiff.writeUInt16BE(4, 24);
  tiff.writeUInt32BE(1, 26);
  tiff.writeUInt32BE(gpsOffset, 30);
  tiff.writeUInt32BE(0, 34);
  tiff.writeUInt16BE(1, gpsOffset);
  // 0x0001 GPSLatitudeRef, ASCII, two bytes inline: "N\0".
  tiff.writeUInt16BE(0x0001, gpsOffset + 2);
  tiff.writeUInt16BE(2, gpsOffset + 4);
  tiff.writeUInt32BE(2, gpsOffset + 6);
  tiff.write('N\0', gpsOffset + 10, 'ascii');
  tiff.writeUInt32BE(0, gpsOffset + 14);
  description.copy(tiff, descriptionOffset);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const segment = Buffer.alloc(4);
  segment.writeUInt8(MARKER, 0);
  segment.writeUInt8(APP1, 1);
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([
    Buffer.from(jpeg.subarray(0, 2)),
    segment,
    payload,
    Buffer.from(jpeg.subarray(2)),
  ]);
}
