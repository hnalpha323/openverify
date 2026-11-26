/**
 * C157.1, C158.3, C159.4 (Workflow 9A, `flow-server-embed`): the flow at `/embed/{inquiry id}`,
 * inside a customer's page. The route in `routes.tsx` that mounts it was placed by `foundation-9a`
 * (Stage 1b (F)), with `flow` the hosted entry's `<Start start={start} />`.
 *
 * - A malformed path id renders `fallback` (the not-found page), as the flow server answers 404.
 * - The flow's client is observed (every call passes through unchanged), so each session the flow
 *   receives reaches the embed bridge (`reportEmbedSession`), and a failure after which the flow
 *   cannot go on reaches it as a public code (`reportEmbedError`).
 * - When a session's inquiry is not the path's, the flow shows its link error (`mismatch`): the
 *   check is against the server's answer, never against the fragment's id, which the link's author
 *   also chose (C158.3, review P10).
 * - A `flow` element whose start it cannot read renders `fallback`: without the session the bridge
 *   cannot check anything, so the embed fails closed.
 */
import { isId } from '@openverify/contracts';
import type { FlowSessionResponse } from '@openverify/contracts';
import { cloneElement, isValidElement, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { FlowApiClient } from '../api/flow-api-client';
import { finalOutcomeOf } from '../api/final-outcome';
import { LinkError } from '../components/link-error';
import type { FlowStart } from '../routes';
import { embedSessionReportOf, reportEmbedError, reportEmbedSession } from './bridge';

export interface EmbedEntryProps {
  /** The flow as the hosted entry renders it, for when the embed's checks pass. */
  readonly flow: ReactNode;
  /** What an unknown path shows: the not-found page. */
  readonly fallback: ReactNode;
}

/** What `observeFlowClient` tells its caller. */
export interface FlowClientObserver {
  /** Every call's answer (the bridge keeps those that are sessions). */
  readonly session: (session: unknown) => void;
  readonly error: (error: unknown) => void;
}

/** `client` with every answer and failure shown to `observer`; each call passes through as made. */
export function observeFlowClient(
  client: FlowApiClient,
  observer: FlowClientObserver,
): FlowApiClient {
  const observed: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(client) as [string, unknown][]) {
    observed[name] =
      typeof method === 'function'
        ? async (...args: unknown[]): Promise<unknown> => {
            try {
              const answer: unknown = await (method as (...call: unknown[]) => unknown)(...args);
              observer.session(answer);
              return answer;
            } catch (error: unknown) {
              observer.error(error);
              throw error;
            }
          }
        : method;
  }
  return observed as unknown as FlowApiClient;
}

/** A flow session answer: the session route and the screen submission answer one. */
function isSession(answer: unknown): answer is FlowSessionResponse {
  if (
    typeof answer !== 'object' ||
    answer === null ||
    !('inquiry' in answer) ||
    !('flow' in answer)
  ) {
    return false;
  }
  const { inquiry } = answer as { readonly inquiry: unknown };
  return (
    typeof inquiry === 'object' &&
    inquiry !== null &&
    typeof (inquiry as { readonly id?: unknown }).id === 'string' &&
    typeof (inquiry as { readonly status?: unknown }).status === 'string'
  );
}

const STATUSES: readonly string[] = ['ready', 'one-time-link', 'handoff', 'error'];

/** The `start` of the hosted entry's element, or `null` when `flow` is not one. */
function startOf(flow: ReactNode): FlowStart | null {
  if (!isValidElement<{ readonly start?: unknown }>(flow)) {
    return null;
  }
  const { start } = flow.props;
  return typeof start === 'object' &&
    start !== null &&
    STATUSES.includes((start as { readonly status?: unknown }).status as string)
    ? (start as FlowStart)
    : null;
}

/** `start` with its client (or the client it connects to) observed. */
function observedStart(start: FlowStart, observer: FlowClientObserver): FlowStart {
  switch (start.status) {
    case 'ready':
      return { ...start, client: observeFlowClient(start.client, observer) };
    case 'one-time-link':
    case 'handoff': {
      const { connect } = start;
      return { ...start, connect: (token) => observeFlowClient(connect(token), observer) };
    }
    case 'error':
      return start;
  }
}

export function EmbedEntry({ flow, fallback }: EmbedEntryProps) {
  const { inquiryId } = useParams();
  const [mismatch, setMismatch] = useState(false);
  const start = startOf(flow);
  const wellFormed = inquiryId !== undefined && isId('inq', inquiryId);

  // Keyed by the start, which the app keeps for the page's life, so the observed client is stable.
  const observed = useMemo(() => {
    if (start === null || !wellFormed) {
      return null;
    }
    return observedStart(start, {
      session: (answer) => {
        if (!isSession(answer)) {
          return;
        }
        const report = embedSessionReportOf(answer);
        if (report.inquiryId !== inquiryId) {
          setMismatch(true);
          return;
        }
        reportEmbedSession(report);
      },
      error: (error) => {
        const outcome = finalOutcomeOf(error);
        if (outcome !== null) {
          reportEmbedError(outcome === 'redacted' ? 'application_error' : 'unauthenticated');
        }
      },
    });
  }, [start, wellFormed, inquiryId]);

  if (observed === null || !isValidElement<{ readonly start: FlowStart }>(flow)) {
    return <>{fallback}</>;
  }
  if (mismatch) {
    return <LinkError reason="mismatch" />;
  }
  return cloneElement(flow, { start: observed });
}
