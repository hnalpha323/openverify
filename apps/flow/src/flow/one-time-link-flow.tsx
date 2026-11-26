import { useEffect, useRef, useState } from 'react';
import { FlowApiError, type FlowApiClient } from '../api/flow-api-client';
import { ApiError } from '../components/api-error';
import { LinkError } from '../components/link-error';
import { LoadingCard } from '../components/loading-card';
import { FlowRenderer } from './flow-renderer';
import { useScreenFocus } from './use-screen-focus';

export interface OneTimeLinkFlowProps {
  /** The inquiry the link was issued for; the redeemed session must belong to it. */
  readonly inquiryId: string;
  /** Redeems the link (C10). Called once, and again only when the user retries a failure. */
  readonly redeem: () => Promise<{ readonly sessionToken: string }>;
  /** The flow client for the redeemed session token. */
  readonly connect: (sessionToken: string) => FlowApiClient;
}

type RedeemState =
  | { readonly status: 'redeeming' }
  | { readonly status: 'ready'; readonly client: FlowApiClient }
  /** The server refused the link: used, expired or unknown (one generic 401). */
  | { readonly status: 'refused' }
  /**
   * The redeem of `attempt` failed and can be retried. While the retry runs (`retrying`), this
   * screen stays, so focus stays on Try again (Workflow 2D F016).
   */
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly attempt: number;
      readonly retrying: boolean;
    };

const isRefusal = (error: unknown): boolean =>
  error instanceof FlowApiError && error.kind === 'http' && error.status === 401;

/** Identifies the screen, so focus moves to the heading of each new one. */
function screenKey(state: RedeemState): string {
  return state.status === 'error' ? `error:${String(state.attempt)}` : state.status;
}

/**
 * Runs the flow from a one-time link (C19): redeems the link, then runs the flow with the
 * session token it got. The token lives only in this component's memory (inside the client),
 * never in storage or the URL, so a reload cannot resume it.
 *
 * A redeem uses the link up, so it is never sent twice for one attempt: not when React runs
 * effects twice (StrictMode), and not when the page re-renders. A request in flight is never
 * aborted either, since the server may already have used the link.
 *
 * Focus (Workflow 2D F016): a retry keeps the error screen, and focus on Try again, until the
 * redeem settles; focus then moves to the heading of the screen that replaces the one shown, as
 * `FlowRenderer` does (which itself moves it to its first step's heading once the session loads).
 */
export function OneTimeLinkFlow({ inquiryId, redeem, connect }: OneTimeLinkFlowProps) {
  const [state, setState] = useState<RedeemState>({ status: 'redeeming' });
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<{
    readonly attempt: number;
    readonly result: Promise<{ readonly sessionToken: string }>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (pending.current?.attempt !== attempt) {
      pending.current = { attempt, result: redeem() };
    }
    pending.current.result.then(
      ({ sessionToken }) => {
        if (active) {
          setState({ status: 'ready', client: connect(sessionToken) });
        }
      },
      (error: unknown) => {
        if (active) {
          setState(
            isRefusal(error)
              ? { status: 'refused' }
              : { status: 'error', error, attempt, retrying: false },
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, redeem, connect]);

  const container = useScreenFocus(screenKey(state));

  let content;
  switch (state.status) {
    case 'redeeming':
      content = <LoadingCard />;
      break;
    case 'ready':
      content = <FlowRenderer client={state.client} inquiryId={inquiryId} />;
      break;
    case 'refused':
      content = <LinkError reason="used" />;
      break;
    case 'error':
      content = (
        <ApiError
          error={state.error}
          retrying={state.retrying}
          onRetry={() => {
            setState({ ...state, retrying: true });
            setAttempt((value) => value + 1);
          }}
        />
      );
      break;
  }

  return <div ref={container}>{content}</div>;
}
