import { describe, expect, it } from 'vitest';
import { defineCopy, type CopyCatalog } from './catalog';
import { CONSOLE_COPY } from './console';

describe('defineCopy (C155.9)', () => {
  it('keeps every message and its type, and freezes the catalog at every depth', () => {
    const copy = defineCopy({
      title: 'Flow builder',
      steps: { count: (count: number) => `${String(count)} steps` },
    });

    expect(copy.title).toBe('Flow builder');
    expect(copy.steps.count(3)).toBe('3 steps');
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.steps)).toBe(true);
  });

  it('types the shared console catalog as a catalog, its messages plain text', () => {
    const catalog: CopyCatalog = CONSOLE_COPY;

    expect(catalog).toBe(CONSOLE_COPY);
    expect(Object.isFrozen(CONSOLE_COPY.templateTabs)).toBe(true);
  });
});
