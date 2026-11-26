/**
 * C135.5, C146.1 (Workflow 8B): the EICAR anti-malware test string, which the sandbox scanner reads
 * as `infected` wherever it appears in an attachment's bytes (an attachment is typed by its magic
 * bytes, so the string travels inside a PNG or a PDF). It is put together from parts so that no file
 * of the repository holds it whole, which a scanner on a developer's machine would flag.
 */
const EICAR = Buffer.from(
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join(''),
  'latin1',
);

/** Whether `bytes` hold the EICAR test string anywhere. */
export function holdsEicar(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(EICAR);
}
