/**
 * C55.10, C55.11: the sandbox SMS sender and its sink. The sender sends nothing: it keeps
 * `{ destination index, code, sent-at }` in the Valkey list `openverify:sandbox-sms:<environment
 * id>`, newest first, at most {@link SANDBOX_SMS_SINK} `maxEntries` for `ttlSeconds`, so a
 * `sandbox:read` key can read the code it sent (`POST /api/v1/sandbox/sms-messages/search`).
 * The number itself is never kept: only its blind index (`otpDestinationIndex`).
 *
 * It is bound for sandbox environments only (a sandbox binding on production stops the API,
 * ADR 0002 §3d).
 */
import { SANDBOX_SMS_SINK, otpCodeSchema } from '@openverify/contracts';
import { z } from 'zod';
import {
  SmsSendError,
  systemClock,
  type Clock,
  type KeyValueCache,
  type SandboxSmsSender,
} from '../../ports.js';

const SINK_KEY_PREFIX = 'openverify:sandbox-sms:';

/** The Valkey list of an environment's sandbox codes. */
export function sandboxSmsSinkKey(environmentId: string): string {
  return `${SINK_KEY_PREFIX}${environmentId}`;
}

/** One code the sink kept, as the search answers it. */
export interface SandboxSmsEntry {
  code: string;
  sentAt: Date;
}

/** An entry as the list stores it: the number's blind index, never the number. */
const storedEntrySchema = z.object({
  'destination-index': z.string().regex(/^[0-9a-f]{64}$/u),
  code: otpCodeSchema,
  'sent-at': z.iso.datetime(),
});

export interface SandboxSmsSenderOptions {
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
}

/**
 * The sandbox sender: keeps the code in the sink and sends nothing. It never claims a send it
 * could not record: without the cache, or when Valkey refuses the write, it fails with
 * `sandbox_sink_unavailable` (retryable while Valkey is down).
 */
export function createSandboxSmsSender(options: SandboxSmsSenderOptions): SandboxSmsSender {
  const { cache } = options;
  const clock = options.clock ?? systemClock;
  return {
    id: 'sandbox',
    sandbox: true,
    async send(_message, context) {
      if (cache === undefined) {
        throw new SmsSendError('sandbox_sink_unavailable', { retryable: false });
      }
      const entry = {
        'destination-index': context.destinationIndex,
        code: context.code,
        'sent-at': clock.now().toISOString(),
      };
      try {
        await cache.pushCapped(
          sandboxSmsSinkKey(context.environmentId),
          JSON.stringify(entry),
          SANDBOX_SMS_SINK.maxEntries,
          SANDBOX_SMS_SINK.ttlSeconds,
        );
      } catch {
        throw new SmsSendError('sandbox_sink_unavailable', { retryable: true });
      }
      return {};
    },
  };
}

function parseEntry(stored: string): z.infer<typeof storedEntrySchema> | null {
  try {
    const parsed = storedEntrySchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The codes the sink kept for the destination index, newest first; an entry it cannot read is
 * skipped.
 * @throws when the cache cannot be read.
 */
export async function readSandboxSmsSink(
  cache: KeyValueCache,
  environmentId: string,
  destinationIndex: string,
): Promise<SandboxSmsEntry[]> {
  const stored = await cache.listRange(
    sandboxSmsSinkKey(environmentId),
    SANDBOX_SMS_SINK.maxEntries,
  );
  return stored.flatMap((raw) => {
    const entry = parseEntry(raw);
    return entry?.['destination-index'] === destinationIndex
      ? [{ code: entry.code, sentAt: new Date(entry['sent-at']) }]
      : [];
  });
}
