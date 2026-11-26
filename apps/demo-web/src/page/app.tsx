/**
 * The sample site's page (plan C266.3): it asks its own server for an inquiry, embeds the flow
 * with `<OpenVerifyFlow>` (over `@openverify/js`), and shows the result its server reports: from a
 * webhook the server verified, or else from the API. The flow's completion in the browser is only
 * a hint, so the page asks its server again until the inquiry is decided. Synthetic use only: this
 * page asks for nothing about a person itself.
 */
import { OpenVerifyFlow } from '@openverify/react';
import { useEffect, useState, type ReactElement } from 'react';

export interface AppProps {
  /** The page's own server; the default is the page's origin. */
  readonly fetch?: typeof fetch;
  /** How often the page asks its server for the result, in ms. */
  readonly pollMs?: number;
}

interface Session {
  readonly inquiryId: string;
  readonly sessionToken: string;
}

interface ServerResult {
  readonly inquiryId: string;
  readonly status: string;
  readonly event: string | null;
  readonly source: 'webhook' | 'api';
}

/** The statuses after which the server's answer no longer changes by itself. */
const DECIDED = new Set(['approved', 'declined', 'expired', 'failed']);

type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'flow'; readonly session: Session }
  | { readonly kind: 'waiting'; readonly session: Session; readonly result: ServerResult | null }
  | { readonly kind: 'decided'; readonly result: ServerResult };

/** The page's own origin's `fetch`, one function for every render. */
const pageFetch: typeof fetch = (input, init) => fetch(input, init);

export function App(props: AppProps): ReactElement {
  const request = props.fetch ?? pageFetch;
  const pollMs = props.pollMs ?? 2000;
  const [flowUrl, setFlowUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const mounted = { live: true };
    void (async () => {
      const response = await request('/api/config');
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const config = (await response.json()) as { flowUrl: string };
      if (mounted.live) {
        setFlowUrl(config.flowUrl);
      }
    })().catch(() => {
      if (mounted.live) {
        setProblem('The page could not load its settings from its server.');
      }
    });
    return () => {
      mounted.live = false;
    };
  }, [request]);

  const waitingFor = stage.kind === 'waiting' ? stage.session.inquiryId : null;
  useEffect(() => {
    if (waitingFor === null) {
      return undefined;
    }
    const mounted = { live: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async (): Promise<void> => {
      try {
        const response = await request(`/api/inquiries/${waitingFor}/result`);
        if (response.ok) {
          const result = (await response.json()) as ServerResult;
          if (!mounted.live) {
            return;
          }
          if (DECIDED.has(result.status)) {
            setStage({ kind: 'decided', result });
            return;
          }
          setStage((current) => (current.kind === 'waiting' ? { ...current, result } : current));
        }
      } catch {
        // The next question may find the server again.
      }
      if (mounted.live) {
        timer = setTimeout(() => void ask(), pollMs);
      }
    };
    void ask();
    return () => {
      mounted.live = false;
      clearTimeout(timer);
    };
  }, [waitingFor, request, pollMs]);

  const start = async (): Promise<void> => {
    setProblem(null);
    try {
      const response = await request('/api/inquiries', { method: 'POST' });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      setStage({ kind: 'flow', session: (await response.json()) as Session });
    } catch {
      setProblem('The verification could not start. Try again in a moment.');
    }
  };

  return (
    <main>
      <h1>Sample customer site</h1>
      <p>
        This is a sample that shows how a site embeds an OpenVerify flow. Use synthetic data only.
        The flow runs on the installation&apos;s server, which decides every step and the result.
      </p>
      {problem === null ? null : <p role="alert">{problem}</p>}
      {stage.kind === 'idle' && flowUrl !== null ? (
        <button type="button" onClick={() => void start()}>
          Verify your identity
        </button>
      ) : null}
      {stage.kind === 'flow' && flowUrl !== null ? (
        <OpenVerifyFlow
          flowUrl={flowUrl}
          inquiryId={stage.session.inquiryId}
          sessionToken={stage.session.sessionToken}
          onComplete={() => {
            setStage({ kind: 'waiting', session: stage.session, result: null });
          }}
          onError={(error) => {
            setProblem(error.message);
            setStage({ kind: 'waiting', session: stage.session, result: null });
          }}
        />
      ) : null}
      {stage.kind === 'waiting' ? (
        <p role="status">
          Waiting for your server to receive the result
          {stage.result === null ? '' : ` (now ${stage.result.status})`}.
        </p>
      ) : null}
      {stage.kind === 'decided' ? (
        <div role="status">
          <p>
            Result: <strong>{stage.result.status}</strong>
          </p>
          <p>
            Decided by the server, as your server learned it
            {stage.result.source === 'webhook'
              ? ` from the verified webhook ${stage.result.event ?? ''}`
              : ' from the API'}
            .
          </p>
        </div>
      ) : null}
    </main>
  );
}
