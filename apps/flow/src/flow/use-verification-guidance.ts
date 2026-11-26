/**
 * C52.2, C64.1: the guidance of a step whose screen needs it before the user acts (the document
 * step's accepted types, window and media types; the business step's required inputs). Guidance
 * comes only with a verification, so the attempt's verification is made when the screen opens,
 * in the background, and read back; the screen shows the step's own values until then, and a
 * failure there is not shown: the user's own action makes (or finds) the verification again.
 */
import type { FlowVerificationResource } from '@openverify/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowApiClient } from '../api/flow-api-client';
import {
  ensureVerification,
  type SubmissionProgress,
  type VerificationApiType,
} from './submit-verification';

export interface VerificationGuidanceOptions {
  readonly client: FlowApiClient;
  readonly type: VerificationApiType;
  /** The attempt's progress, shared with the screen's own requests. */
  readonly progress: SubmissionProgress;
  /** The resumed attempt's resource, whose guidance the session already carries. */
  readonly verification: FlowVerificationResource | undefined;
  /**
   * Whether to make the verification as soon as the screen opens, for its guidance (the
   * default); a screen that needs none before the user acts makes it with the user's request.
   */
  readonly eager?: boolean;
}

export interface VerificationGuidance {
  /** The attempt's resource once known: the resumed one, or the one made for this screen. */
  readonly verification: FlowVerificationResource | undefined;
  /** The attempt's verification ID, made at most once, whoever asks first. */
  readonly verificationId: (signal?: AbortSignal) => Promise<string>;
}

export function useVerificationGuidance({
  client,
  type,
  progress,
  verification,
  eager = true,
}: VerificationGuidanceOptions): VerificationGuidance {
  const [made, setMade] = useState<FlowVerificationResource | undefined>(undefined);
  // The request in flight, shared by the background read and the screen's own requests; a failed
  // one is forgotten so the next request tries again (`ensureVerification` first checks whether an
  // unanswered create reached the server).
  const inFlight = useRef<Promise<string> | null>(null);

  const verificationId = useCallback(
    (signal?: AbortSignal): Promise<string> => {
      if (inFlight.current === null) {
        const request = ensureVerification(client, type, progress, signal);
        inFlight.current = request;
        request.catch(() => {
          if (inFlight.current === request) {
            inFlight.current = null;
          }
        });
      }
      return inFlight.current;
    },
    [client, type, progress],
  );

  const needed = eager && verification === undefined;
  // The background read, at most once per screen: React's development double-run of effects
  // reuses the request in flight, and only the latest run applies its answer.
  const read = useRef<Promise<FlowVerificationResource | null> | null>(null);
  useEffect(() => {
    if (!needed) {
      return undefined;
    }
    read.current ??= verificationId()
      .then((id) => client.getVerification(id))
      .catch(() => null);
    let active = true;
    void read.current.then((resource) => {
      if (active && resource !== null) {
        setMade(resource);
      }
    });
    return () => {
      active = false;
    };
  }, [client, needed, verificationId]);

  return { verification: verification ?? made, verificationId };
}
