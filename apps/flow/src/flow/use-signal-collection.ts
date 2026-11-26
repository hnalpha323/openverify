import type { FlowSessionResponse } from '@openverify/contracts';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { FlowApiClient } from '../api/flow-api-client';
import { startSignalCollection, type SignalCollection } from '../signals';
import { flushBeforeSubmission } from '../signals/flush-before-submission';
import type { FlowPosition } from './flow-position';

/** The step a position shows, or `null` for one without a step (an expired inquiry). */
export function stepIdOf(position: FlowPosition | null): string | null {
  if (position === null || position.kind === 'expired' || position.kind === 'halted') {
    return null;
  }
  // C150.5: a waiting position names the step the server is on, for the collector's screen.
  return position.kind === 'waiting' ? position.stepId : (position.step?.id ?? null);
}

/** A position after the person's part: the inquiry's sessions have ended, so no body can land. */
function isFinished(position: FlowPosition | null): boolean {
  return (
    position?.kind === 'completion' || position?.kind === 'failure' || position?.kind === 'expired'
  );
}

/**
 * C94.3, C94.6 (Workflow 7A, F06, P14): runs the signal collection of `client-collector`
 * (`startSignalCollection`) for the session, from the moment it reports its consent: never
 * before, so nothing is read or listened to on the consent screen. It starts with the tiers
 * `GET /flow/session` reports (`null` when the session may not collect, which reads nothing),
 * posts each body through `client`, tells it every screen the person reaches, and stops it when
 * the flow unmounts or the tiers change. It answers the client the steps use: one whose
 * submissions first send the open screen's body (`flushBeforeSubmission`), so the last screen
 * reaches the server before the inquiry completes and its sessions end (C90.5).
 *
 * C96.8 (K7A-4): an outcome screen collects nothing. A finished inquiry's session may still read
 * but no longer write, so a body sent from there comes back as `session_canceled`, which would
 * replace the outcome with the session-ended screen: the desktop's waiting screen, closed by the
 * phone's completion, did that. Its body stays a gap in the data, never evidence.
 *
 * The collection also flushes on `pagehide`, so the screen open when a tab closes is not lost.
 */
export function useSignalCollection(
  client: FlowApiClient,
  session: FlowSessionResponse | null,
  position: FlowPosition | null,
): FlowApiClient {
  const consented = session !== null && session.consent !== null;
  const finished = isFinished(position);
  const signals = session?.signals ?? null;
  // A stable key, so a refreshed session with the same tiers keeps its collection; a new
  // `next-sequence` is not a new collection.
  const tiers =
    consented && !finished
      ? JSON.stringify(
          signals === null
            ? null
            : { integrity: signals.integrity, recognition: signals.recognition },
        )
      : null;
  const collection = useRef<SignalCollection | null>(null);
  const stepId = consented && !finished ? stepIdOf(position) : null;
  // Set before the effects below, whose cleanup closes the open screen and so sends its body.
  const ended = useRef(finished);
  useLayoutEffect(() => {
    ended.current = finished;
  }, [finished]);
  // K7A-7: read once, when the collection starts: a running collector numbers its own bodies.
  const firstSequence = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    firstSequence.current = signals?.['next-sequence'];
  }, [signals]);

  useEffect(() => {
    if (tiers === null) {
      return undefined;
    }
    const started = startSignalCollection({
      tiers: JSON.parse(tiers) as Parameters<typeof startSignalCollection>[0]['tiers'],
      send: (body) => (ended.current ? Promise.resolve() : client.sendSignals(body)),
      platform: 'web',
      ...(firstSequence.current === undefined ? {} : { firstSequence: firstSequence.current }),
    });
    collection.current = started;
    return () => {
      started.stop();
      collection.current = null;
    };
  }, [client, tiers]);

  useEffect(() => {
    if (stepId !== null) {
      collection.current?.screen(stepId);
    }
  }, [stepId, tiers]);

  // K7A-11: the open screen's body when the page goes. It lives here, outside the collector's size
  // budget. A send that still fails stays a gap in the data, never evidence.
  useEffect(() => {
    const flush = () => {
      void collection.current?.flush();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  return useMemo(() => flushBeforeSubmission(client, () => collection.current?.flush()), [client]);
}
