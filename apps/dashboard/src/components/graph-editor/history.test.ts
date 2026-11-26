import { describe, expect, it } from 'vitest';
import {
  endGesture,
  HISTORY_LIMIT,
  isRedoKey,
  isUndoKey,
  record,
  redo,
  startHistory,
  undo,
} from './history';

const key = (
  name: string,
  modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>,
) => ({ key: name, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers });

describe('undo and redo (C141.4)', () => {
  it('undoes and redoes each record in turn', () => {
    let history = startHistory('a');
    history = record(history, 'b');
    history = record(history, 'c');
    expect(history.present).toBe('c');
    history = undo(history);
    expect(history.present).toBe('b');
    history = undo(history);
    expect(history.present).toBe('a');
    expect(undo(history)).toBe(history);
    history = redo(history);
    expect(history.present).toBe('b');
    history = redo(redo(history));
    expect(history.present).toBe('c');
    expect(history.future).toEqual([]);
  });

  it('forgets what was undone once a new record is made', () => {
    let history = record(record(startHistory('a'), 'b'), 'c');
    history = record(undo(history), 'd');
    expect(history.past).toEqual(['a', 'b']);
    expect(history.future).toEqual([]);
    expect(redo(history)).toBe(history);
  });

  it('coalesces one gesture into one entry until the gesture ends', () => {
    let history = startHistory('');
    history = record(history, 'n', 'rename:first');
    history = record(history, 'na', 'rename:first');
    history = record(history, 'nam', 'rename:first');
    expect(history.past).toEqual(['']);
    expect(history.present).toBe('nam');
    history = record(endGesture(history), 'name', 'rename:first');
    expect(history.past).toEqual(['', 'nam']);
    history = record(history, 'other', 'move:first');
    expect(history.past).toEqual(['', 'nam', 'name']);
    expect(undo(history).gesture).toBeNull();
  });

  it('keeps at most 100 entries, dropping the oldest', () => {
    let history = startHistory(0);
    for (let value = 1; value <= HISTORY_LIMIT + 20; value += 1) {
      history = record(history, value);
    }
    expect(HISTORY_LIMIT).toBe(100);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(20);
    let undone = history;
    for (let step = 0; step < HISTORY_LIMIT + 5; step += 1) {
      undone = undo(undone);
    }
    expect(undone.present).toBe(20);
  });

  it('does not record a document that is the present one', () => {
    const history = startHistory('a');
    expect(record(history, 'a')).toBe(history);
  });
});

describe('the undo and redo keys (C141.4, WCAG 2.1.4)', () => {
  it('reads Ctrl or Cmd with Z as undo, and with Shift, or Ctrl with Y, as redo', () => {
    expect(isUndoKey(key('z', { ctrlKey: true }))).toBe(true);
    expect(isUndoKey(key('Z', { metaKey: true }))).toBe(true);
    expect(isUndoKey(key('z', {}))).toBe(false);
    expect(isUndoKey(key('z', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoKey(key('z', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isRedoKey(key('Z', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isRedoKey(key('z', { metaKey: true, shiftKey: true }))).toBe(true);
    expect(isRedoKey(key('y', { ctrlKey: true }))).toBe(true);
    expect(isRedoKey(key('y', {}))).toBe(false);
    expect(isRedoKey(key('z', { ctrlKey: true }))).toBe(false);
  });
});
