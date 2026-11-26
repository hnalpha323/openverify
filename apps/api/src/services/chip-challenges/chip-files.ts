/**
 * C52.4, C62.5, C62.6: a verification's chip files as `@openverify/emrtd` reads them. Each upload is
 * decrypted from storage (its own data key, the file id as context) and checked against its stored
 * SHA-256; the latest upload of each kind counts. The bytes are chip evidence (biometric for DG2):
 * in memory only, never logged.
 */
import { createHash } from 'node:crypto';
import { decryptBytes, type FileKind, type Keyring, type StoredFile } from '@openverify/db';
import type { ChipFiles, DataGroupNumber } from '@openverify/emrtd';
import type { FileStorage } from '../../ports.js';

/** The data groups Phase 5 takes (C52.4, `TAKEN_DATA_GROUPS`) and their upload kinds. */
export const CHIP_DATA_GROUP_KINDS = Object.freeze({
  1: 'chip-dg1',
  2: 'chip-dg2',
  14: 'chip-dg14',
  15: 'chip-dg15',
} as const satisfies Partial<Record<DataGroupNumber, FileKind>>);

/** Why a stored chip file could not be read (the job's permanent failure codes). */
export type ChipFileProblem = 'file_missing' | 'file_undecryptable' | 'file_integrity';

/** A stored chip file is gone, cannot be decrypted, or is not the bytes uploaded. */
export class ChipFileUnreadableError extends Error {
  override name = 'ChipFileUnreadableError';
  readonly code: ChipFileProblem;

  constructor(code: ChipFileProblem) {
    super(`chip file unreadable (${code})`);
    this.code = code;
  }
}

export interface ChipFileDeps {
  storage: FileStorage;
  keyring: Keyring;
}

/** The latest upload of `kind` (files are listed oldest first). */
export const latestChipFile = (
  files: readonly StoredFile[],
  kind: FileKind,
): StoredFile | undefined => files.filter((file) => file.kind === kind).at(-1);

/**
 * The decrypted bytes of a stored chip file.
 * @throws {ChipFileUnreadableError} when its object is gone, undecryptable or altered.
 */
export async function readChipFile(deps: ChipFileDeps, file: StoredFile): Promise<Uint8Array> {
  const ciphertext = await deps.storage.get(file.storageKey);
  if (ciphertext === null) {
    throw new ChipFileUnreadableError('file_missing');
  }
  let bytes: Buffer;
  try {
    bytes = decryptBytes({ wrappedDek: file.wrappedDek, ciphertext }, deps.keyring, {
      context: file.id,
    });
  } catch {
    throw new ChipFileUnreadableError('file_undecryptable');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    bytes.fill(0);
    throw new ChipFileUnreadableError('file_integrity');
  }
  return new Uint8Array(bytes);
}

/**
 * The verification's chip files, the latest of each kind; `null` without a SOD.
 * @throws {ChipFileUnreadableError} when a stored file cannot be read.
 */
export async function loadChipFiles(
  deps: ChipFileDeps,
  files: readonly StoredFile[],
): Promise<ChipFiles | null> {
  const read = async (kind: FileKind) => {
    const file = latestChipFile(files, kind);
    return file === undefined ? undefined : readChipFile(deps, file);
  };
  const sod = await read('chip-sod');
  if (sod === undefined) {
    return null;
  }
  const dataGroups: Partial<Record<DataGroupNumber, Uint8Array>> = {};
  for (const [group, kind] of Object.entries(CHIP_DATA_GROUP_KINDS)) {
    const bytes = await read(kind);
    if (bytes !== undefined) {
      dataGroups[Number(group) as DataGroupNumber] = bytes;
    }
  }
  return {
    sod,
    dataGroups,
    cardSecurity: await read('chip-card-security'),
    cardAccess: await read('chip-card-access'),
    com: await read('chip-com'),
  };
}

/** Overwrites every byte of `files`, once the job is done with them. */
export function wipeChipFiles(files: ChipFiles | null): void {
  if (files === null) {
    return;
  }
  files.sod.fill(0);
  for (const bytes of Object.values(files.dataGroups)) {
    bytes.fill(0);
  }
  files.cardSecurity?.fill(0);
  files.cardAccess?.fill(0);
  files.com?.fill(0);
}
