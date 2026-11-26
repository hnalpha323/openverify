/**
 * C142.3 (editor note 7.5 to 7.7): the compare panel, used by keyboard alone. Each viewer zooms,
 * pans, resets and rotates through its own buttons, and through the keys `+`, `-`, `0`, the arrows
 * and `R` only while the viewer itself has focus (2.1.4); "Link views" applies one zoom and pan to
 * both; brightness, contrast and grayscale are viewing aids that change nothing stored.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompareViewer, type CompareImage } from './compare-viewer';

// `@panzoom/panzoom` is an ES module whose `main` is a UMD build: bundlers read its `module`
// entry, and Vitest, which follows `main`, is pointed at the same ES build here.
vi.mock('@panzoom/panzoom', async () => {
  const entry = '@panzoom/panzoom/dist/panzoom.es.js';
  return (await import(/* @vite-ignore */ entry)) as typeof import('@panzoom/panzoom');
});

const FRONT: CompareImage = {
  id: 'file_01JE0000000000000000000011',
  src: '/files/file_01JE0000000000000000000011/rendition',
  alt: 'Government ID front, whose portrait was compared',
  caption: 'Government ID front',
};
const CENTRE: CompareImage = {
  id: 'file_01JE0000000000000000000012',
  src: '/files/file_01JE0000000000000000000012/rendition',
  alt: 'Selfie, centre pose',
  caption: 'Selfie, centre pose',
};
const LEFT: CompareImage = {
  id: 'file_01JE0000000000000000000013',
  src: '/files/file_01JE0000000000000000000013/rendition',
  alt: 'Selfie, left pose',
  caption: 'Selfie, left pose',
};

afterEach(() => {
  vi.restoreAllMocks();
});

const viewer = (caption: string) => screen.getByRole('group', { name: `${caption} viewer` });
const state = (caption: string) => within(viewer(caption)).getByRole('status').textContent;
const zoomOf = (caption: string) => Number(/Zoom (\d+)%/.exec(state(caption))?.[1] ?? 'NaN');

function setup(extra: readonly CompareImage[] = []) {
  const user = userEvent.setup();
  render(<CompareViewer images={[FRONT, CENTRE]} extra={extra} />);
  return user;
}

describe('CompareViewer', () => {
  it('shows the two images side by side, each in a viewer that names its keys', () => {
    setup();

    for (const image of [FRONT, CENTRE]) {
      const group = viewer(image.caption);
      expect(within(group).getByRole('img', { name: image.alt })).toHaveAttribute('src', image.src);
      expect(group).toHaveAttribute(
        'aria-keyshortcuts',
        '+ - 0 ArrowUp ArrowDown ArrowLeft ArrowRight R',
      );
      expect(group).toHaveAttribute('tabindex', '0');
      expect(state(image.caption)).toContain('Zoom 100%');
    }
  });

  it('takes focus, and says it is ready, only once its keys act, so no key pressed before is lost (2.1.1, K8-36)', () => {
    // As the server sends it, before hydration and before panzoom is attached: a key pressed on it
    // then would reach no handler, so it is not focusable yet, and says it is busy.
    const served = document.createElement('div');
    served.innerHTML = renderToString(<CompareViewer images={[FRONT, CENTRE]} />);
    for (const image of [FRONT, CENTRE]) {
      const group = served.querySelector(`[aria-label="${image.caption} viewer"]`);
      expect(group).not.toBeNull();
      expect(group).not.toHaveAttribute('tabindex');
      expect(group).toHaveAttribute('aria-busy', 'true');
    }

    setup();

    for (const image of [FRONT, CENTRE]) {
      expect(viewer(image.caption)).toHaveAttribute('tabindex', '0');
      expect(viewer(image.caption)).not.toHaveAttribute('aria-busy');
    }
  });

  it('zooms, pans, resets and rotates by keys while the viewer has focus', async () => {
    const user = setup();

    viewer(FRONT.caption).focus();
    await user.keyboard('+');
    expect(zoomOf(FRONT.caption)).toBeGreaterThan(100);
    expect(zoomOf(CENTRE.caption)).toBe(100);

    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(state(FRONT.caption)).not.toContain('offset 0, 0');

    await user.keyboard('r');
    expect(state(FRONT.caption)).toContain('rotated 90°');

    await user.keyboard('0');
    expect(state(FRONT.caption)).toBe('Zoom 100%, offset 0, 0, rotated 0°');

    await user.keyboard('-');
    expect(zoomOf(FRONT.caption)).toBeLessThan(100);
  });

  it('ignores the character keys when focus is on one of its buttons, not on the viewer', async () => {
    const user = setup();

    within(viewer(FRONT.caption)).getByRole('button', { name: 'Reset' }).focus();
    await user.keyboard('+r');

    expect(state(FRONT.caption)).toBe('Zoom 100%, offset 0, 0, rotated 0°');
  });

  it('names each button by its visible text, or by a symbol that is no word (axe label-content-name-mismatch, 2.5.3, Workflow 8D review R002)', () => {
    setup();

    for (const button of within(viewer(FRONT.caption)).getAllByRole('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent;
      // The text a speech user reads off the button: its letters and digits, not its symbols.
      const visible = button.textContent.replace(/[^\p{L}\p{N}]/gu, '');
      expect(name).toContain(visible);
    }
    expect(within(viewer(FRONT.caption)).getByRole('button', { name: 'Reset' })).toHaveTextContent(
      'Reset',
    );
  });

  it('offers every key as a button, so nothing needs a drag or a key (2.5.7)', async () => {
    const user = setup();
    const front = within(viewer(FRONT.caption));

    await user.click(front.getByRole('button', { name: 'Zoom in' }));
    expect(zoomOf(FRONT.caption)).toBeGreaterThan(100);
    await user.click(front.getByRole('button', { name: 'Move right' }));
    await user.click(front.getByRole('button', { name: 'Rotate' }));
    expect(state(FRONT.caption)).toContain('rotated 90°');
    await user.click(front.getByRole('button', { name: 'Reset' }));
    expect(state(FRONT.caption)).toBe('Zoom 100%, offset 0, 0, rotated 0°');
    for (const name of ['Zoom out', 'Move left', 'Move up', 'Move down']) {
      expect(front.getByRole('button', { name })).toBeVisible();
    }
  });

  it('applies one zoom and pan to both images while "Link views" is on', async () => {
    const user = setup();
    const link = screen.getByRole('button', { name: 'Link views' });
    expect(link).toHaveAttribute('aria-pressed', 'false');

    await user.click(link);
    expect(link).toHaveAttribute('aria-pressed', 'true');
    viewer(FRONT.caption).focus();
    await user.keyboard('++{ArrowLeft}');

    expect(zoomOf(CENTRE.caption)).toBe(zoomOf(FRONT.caption));
    expect(state(CENTRE.caption)).toBe(state(FRONT.caption).replace(/rotated \d+°/, 'rotated 0°'));
  });

  it('changes brightness, contrast and grayscale as viewing aids on both images, storing nothing', async () => {
    const user = setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), {
      target: { value: '150' },
    });
    fireEvent.change(screen.getByRole('slider', { name: 'Contrast' }), {
      target: { value: '80' },
    });
    await user.click(screen.getByRole('button', { name: 'Grayscale' }));

    for (const image of [FRONT, CENTRE]) {
      const filter = within(viewer(image.caption)).getByRole('img').parentElement?.style.filter;
      expect(filter).toBe('brightness(1.5) contrast(0.8) grayscale(1)');
    }
    expect(screen.getByRole('button', { name: 'Grayscale' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the side poses only on request', async () => {
    const user = setup([LEFT]);

    expect(screen.queryByRole('img', { name: LEFT.alt })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show the side poses' }));
    expect(screen.getByRole('img', { name: LEFT.alt })).toHaveAttribute('src', LEFT.src);
  });
});
