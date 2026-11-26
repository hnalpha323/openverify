/**
 * Polls until `poll` reports it is done, waiting `intervalMs` between polls. After `maxPolls`
 * polls the status becomes `timed-out`; after `maxErrors` consecutive failures it becomes
 * `failed`. `restart()` starts over. Polling stops when the component unmounts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type PollingStatus = 'polling' | 'timed-out' | 'failed';

export interface PollingOptions {
  readonly intervalMs: number;
  readonly maxPolls: number;
  /** Consecutive failed polls before giving up. Defaults to 3. */
  readonly maxErrors?: number;
}

export interface Polling {
  readonly status: PollingStatus;
  /** The last error, once `status` is `failed`. */
  readonly error: unknown;
  readonly restart: () => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** `poll` resolves `true` once there is nothing more to wait for. */
export function usePolling(
  poll: (signal: AbortSignal) => Promise<boolean>,
  { intervalMs, maxPolls, maxErrors = 3 }: PollingOptions,
): Polling {
  const [state, setState] = useState<{ status: PollingStatus; error: unknown }>({
    status: 'polling',
    error: null,
  });
  const [run, setRun] = useState(0);
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    // A function, not a narrowed property: the signal can abort during any await.
    const stopped = () => signal.aborted;

    const loop = async () => {
      let errors = 0;
      for (let count = 0; count < maxPolls; count += 1) {
        if (count > 0) {
          await sleep(intervalMs, signal);
        }
        if (stopped()) {
          return;
        }
        try {
          if (await pollRef.current(signal)) {
            return;
          }
          errors = 0;
        } catch (error: unknown) {
          if (stopped()) {
            return;
          }
          errors += 1;
          if (errors >= maxErrors) {
            setState({ status: 'failed', error });
            return;
          }
        }
      }
      if (!stopped()) {
        setState({ status: 'timed-out', error: null });
      }
    };

    void loop();
    return () => {
      controller.abort();
    };
  }, [run, intervalMs, maxPolls, maxErrors]);

  const restart = useCallback(() => {
    setState({ status: 'polling', error: null });
    setRun((value) => value + 1);
  }, []);

  return { status: state.status, error: state.error, restart };
}
