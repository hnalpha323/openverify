/**
 * Undo and redo over immutable documents (C141.4, editor note 2.3): our own, never the vendor's Pro
 * example. Every edit records the next document; one gesture (typing in a field, dragging or
 * nudging one node) is one entry, because records that carry the same gesture key replace the
 * present instead of stacking. At most 100 entries are kept. Selection is not history.
 */

/** C141.4: the most entries kept. */
export const HISTORY_LIMIT = 100;

export interface History<Document> {
  readonly past: readonly Document[];
  readonly present: Document;
  readonly future: readonly Document[];
  /** The gesture the present belongs to, while it lasts. */
  readonly gesture: string | null;
}

export function startHistory<Document>(present: Document): History<Document> {
  return { past: [], present, future: [], gesture: null };
}

/**
 * Records `next` as the present. While `gesture` names the present's gesture, the present is
 * replaced; otherwise the present joins the past (the oldest dropped past 100) and the future is
 * forgotten. Recording the present itself changes nothing.
 */
export function record<Document>(
  history: History<Document>,
  next: Document,
  gesture?: string,
): History<Document> {
  if (Object.is(next, history.present)) {
    return history;
  }
  if (gesture !== undefined && gesture === history.gesture) {
    return { ...history, present: next, future: [] };
  }
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], gesture: gesture ?? null };
}

/** Ends the present gesture, so the next record is an entry of its own. */
export function endGesture<Document>(history: History<Document>): History<Document> {
  return history.gesture === null ? history : { ...history, gesture: null };
}

export function undo<Document>(history: History<Document>): History<Document> {
  const previous = history.past.at(-1);
  if (history.past.length === 0) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: previous as Document,
    future: [history.present, ...history.future],
    gesture: null,
  };
}

export function redo<Document>(history: History<Document>): History<Document> {
  const [next, ...future] = history.future;
  if (history.future.length === 0) {
    return history;
  }
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next as Document,
    future,
    gesture: null,
  };
}

interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

const command = (event: KeyLike) => (event.ctrlKey || event.metaKey) && !event.altKey;

/** Ctrl or Cmd with Z (C141.4). */
export function isUndoKey(event: KeyLike): boolean {
  return command(event) && !event.shiftKey && event.key.toLowerCase() === 'z';
}

/** Ctrl or Cmd with Shift and Z, or Ctrl with Y (C141.4). */
export function isRedoKey(event: KeyLike): boolean {
  const key = event.key.toLowerCase();
  return (
    command(event) &&
    ((event.shiftKey && key === 'z') || (!event.shiftKey && event.ctrlKey && key === 'y'))
  );
}
