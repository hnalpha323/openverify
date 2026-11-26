/**
 * C135.5 (Workflow 8B (F); decision 66, P23, H20): the attachment scanner's providers, bound in the
 * worker where the `case-attachment-scan` job runs.
 *
 * - `none` (the default, and an unset kind): no scanner is bound, so every attachment is
 *   `not_scanned`, served behind a warning;
 * - `sandbox`: deterministic, bytes holding the EICAR test string are `infected` and everything else
 *   `clean`; refused for production by the binding's rule. It is no scan: the console says so;
 * - `clamd`: an operator-run service over `OPENVERIFY_CLAMD_SOCKET` (a Unix socket path, or a
 *   `host:port` on a private network), through our own `INSTREAM` client ({@link scanWithClamd}),
 *   which maps every answer that is not a clean one, a size-limit refusal included, to `error`, never
 *   `clean`. No ClamAV image ships (ClamAV is GPL-2.0).
 *
 * Owner `api-case-files`; `foundation-8b` froze the factory and bound it.
 */
import type { AttachmentScanner } from '../../ports.js';
import { CLAMD_TIMEOUT_MS, scanWithClamd } from './clamd.js';
import { holdsEicar } from './eicar.js';

/** The providers that scan; `none` binds nothing. */
export const ATTACHMENT_SCANNER_PROVIDERS = ['sandbox', 'clamd'] as const;
export type AttachmentScannerProvider = (typeof ATTACHMENT_SCANNER_PROVIDERS)[number];

export interface AttachmentScannerOptions {
  /** `OPENVERIFY_CLAMD_SOCKET`: a Unix socket path or a private address; required for `clamd`. */
  clamdSocket: string | null;
  /** How long clamd may take to answer one scan before it reads `error`; 30 s by default. */
  clamdTimeoutMs?: number | undefined;
}

/**
 * The scanner bound to one environment kind.
 * @throws {Error} for `clamd` without its socket (the worker's configuration already requires it).
 */
export function createAttachmentScanner(
  provider: AttachmentScannerProvider,
  options: AttachmentScannerOptions,
): AttachmentScanner {
  if (provider === 'sandbox') {
    return {
      provider,
      scan: ({ bytes }) =>
        Promise.resolve({ verdict: holdsEicar(bytes) ? 'infected' : 'clean', provider }),
    };
  }
  const socket = options.clamdSocket;
  if (socket === null) {
    throw new Error('clamd needs its socket (OPENVERIFY_CLAMD_SOCKET)');
  }
  const timeoutMs = options.clamdTimeoutMs ?? CLAMD_TIMEOUT_MS;
  return {
    provider,
    scan: async ({ bytes }) => ({
      verdict: await scanWithClamd(socket, bytes, timeoutMs),
      provider,
    }),
  };
}
