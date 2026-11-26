/**
 * The flow's signal hook (plan C94.3, C94.4, C94.6, F06): `FlowRenderer` calls it after consent
 * with the tiers `GET /api/v1/flow/session` reports, and a `send` that posts to
 * `POST /api/v1/flow/signals`. It runs the browser collector of `@openverify/signals/browser`:
 * under session integrity, one body of integrity artefacts and behaviour aggregates per screen,
 * sent when the screen closes (the next screen, or `stop`); under device recognition, the device
 * components once, in their own body.
 *
 * With `tiers: null` (the session may not collect), or both tiers off, it reads, listens to and
 * sends nothing (P14). The collector makes no request itself, uses no storage, and swallows every
 * failure, including a rejected `send`: the person never sees one.
 */
import type { FlowSessionSignals, FlowSignals } from '@openverify/contracts';
// The collector's entry has no runtime dependency of its own, so the flow bundles exactly the
// measured code (the `@openverify/source` condition resolves it to its TypeScript source).
import { startCollector } from '@openverify/signals/browser';

export interface SignalCollectionOptions {
  /** The session's collector tiers, or `null` while it may not collect. */
  readonly tiers: FlowSessionSignals | null;
  /** Posts one body; a failure is swallowed by the collector, never shown to the person. */
  readonly send: (body: FlowSignals) => Promise<void>;
  readonly platform: 'web';
  /** K7A-7: the session's `next-sequence`: the first body's number after a reload. */
  readonly firstSequence?: number;
}

export interface SignalCollection {
  /** Whether a tier is on: the collector listens and sends only then. */
  readonly collecting: boolean;
  /** The flow moved to the step `stepId`: the previous screen closes and its body is sent. */
  screen(stepId: string): void;
  /** Closes the current screen (sending its body) and removes every listener; idempotent. */
  stop(): void;
  /**
   * Closes the current screen, sends its body and settles once every body sent so far has
   * settled; the flow calls it before a submission that can end the inquiry (C90.5).
   */
  flush(): Promise<void>;
}

/**
 * Starts collection for one session under its reported tiers. The collector's handle is the
 * flow's: its bodies are `FlowSignals` (its own test asserts the schema parses each).
 */
export function startSignalCollection(options: SignalCollectionOptions): SignalCollection {
  return startCollector({
    tiers: options.tiers,
    send: options.send,
    ...(options.firstSequence === undefined ? {} : { firstSequence: options.firstSequence }),
  });
}
