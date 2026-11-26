'use client';

import { Button } from '@openverify/ui';
import { useEffect, useRef, useState } from 'react';
import { RedactedValue } from './lifecycle/redacted-value';

/** How many times a rendition still being made is asked for before the image stops asking. */
export const RENDITION_ATTEMPTS = 12;

/** The console waits at least a second and at most half a minute between two asks. */
const RETRY_MIN_SECONDS = 1;
const RETRY_MAX_SECONDS = 30;

export interface RenditionImageProps {
  /** The console route of the rendition, such as `/files/file_…/rendition` or `…?page=2`. */
  readonly src: string;
  /** Names the image's role ("Government ID, front"), never the person (1.1.1). */
  readonly alt: string;
  readonly className?: string;
}

type View =
  | { readonly kind: 'image' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'still-preparing' }
  | { readonly kind: 'refused'; readonly status: number }
  | { readonly kind: 'failed' };

/** `src` with the retry counter, so the browser asks again instead of reusing its last answer. */
function attemptSrc(src: string, attempt: number): string {
  if (attempt === 0) {
    return src;
  }
  return `${src}${src.includes('?') ? '&' : '?'}attempt=${String(attempt)}`;
}

function retrySeconds(response: Response): number {
  const seconds = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
  return Number.isFinite(seconds)
    ? Math.min(RETRY_MAX_SECONDS, Math.max(RETRY_MIN_SECONDS, seconds))
    : RETRY_MIN_SECONDS * 5;
}

/** What an answer other than an image means, in words. */
function refusalOf(status: number) {
  switch (status) {
    case 403:
      return 'Hidden: your role cannot view personal data.';
    case 410:
      return <RedactedValue />;
    case 404:
      return 'No image to show.';
    case 409:
      return 'The file is not served until its scan says it is clean.';
    default:
      return 'The image could not be prepared.';
  }
}

const PLACEHOLDER_CLASS =
  'flex min-h-24 w-48 max-w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-canvas p-2 text-center text-sm text-ink-muted';

/**
 * An image the console serves as a rendition (C135.3, decision 63): the image re-encoded without
 * metadata, made asynchronously by the vision service. A rendition not made yet answers 202, which
 * an `<img>` reads as a broken image; the image then asks the route once what it answered and, for
 * a 202, says "Preparing the image" in a polite status and asks again after the `Retry-After`, at
 * most {@link RENDITION_ATTEMPTS} times, then offers "Try again". An image the route serves but the
 * browser cannot show (an error after a check found it ready) also ends at "Try again", so the
 * image never asks without end (each ask is an audited view). Every other answer is said in
 * words. Nothing is cached or kept in the browser: the route answers `private, no-store`, and the
 * retry counter in the URL only keeps the browser from reusing its last answer.
 */
export function RenditionImage({ src, alt, className }: RenditionImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>({ kind: 'image' });
  const asked = useRef(0);
  // Checks that found the image ready: one more error after one means the browser cannot show what
  // the route serves (truncated, undecodable or blocked), so the image stops asking (R013).
  const ready = useRef(0);
  // Every request, the image's and the check's, carries a counter of its own.
  const used = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const showAgain = () => {
    used.current += 1;
    setAttempt(used.current);
    setView({ kind: 'image' });
  };

  const check = async () => {
    setView({ kind: 'checking' });
    asked.current += 1;
    used.current += 1;
    let response: Response;
    try {
      response = await fetch(attemptSrc(src, used.current), {
        cache: 'no-store',
        credentials: 'same-origin',
      });
    } catch {
      setView({ kind: 'failed' });
      return;
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 200) {
      ready.current += 1;
      if (ready.current > 1) {
        setView({ kind: 'failed' });
        return;
      }
      showAgain();
    } else if (response.status === 202) {
      if (asked.current >= RENDITION_ATTEMPTS) {
        setView({ kind: 'still-preparing' });
        return;
      }
      setView({ kind: 'preparing' });
      timer.current = setTimeout(showAgain, retrySeconds(response) * 1_000);
    } else if ([403, 404, 409, 410, 422].includes(response.status)) {
      setView({ kind: 'refused', status: response.status });
    } else {
      setView({ kind: 'failed' });
    }
  };

  const tryAgain = () => {
    asked.current = 0;
    ready.current = 0;
    showAgain();
  };

  if (view.kind === 'image') {
    return (
      // Served by our authenticated proxy; next/image would need a loader for it.
      <img
        key={attempt}
        src={attemptSrc(src, attempt)}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={className}
        ref={(node) => {
          // An image the server rendered can fail (a 202) before the page is hydrated, and React
          // never sees that error event: a broken image found at mount is checked as if it had
          // just failed. A lazy image not loaded yet is not complete, so it is left alone.
          if (node?.complete === true && node.naturalWidth === 0) {
            void check();
          }
        }}
        onError={() => {
          void check();
        }}
      />
    );
  }
  return (
    <div className={PLACEHOLDER_CLASS}>
      <span role="status" aria-live="polite" className="flex flex-col items-center gap-1">
        <span className="sr-only">{alt}: </span>
        {view.kind === 'checking' || view.kind === 'preparing' ? (
          <span>Preparing the image…</span>
        ) : view.kind === 'still-preparing' ? (
          <span>The image is still being prepared.</span>
        ) : view.kind === 'refused' ? (
          refusalOf(view.status)
        ) : (
          <span>The image could not be loaded.</span>
        )}
      </span>
      {(view.kind === 'still-preparing' || view.kind === 'failed') && (
        <Button variant="secondary" onClick={tryAgain}>
          Try again
        </Button>
      )}
    </div>
  );
}
