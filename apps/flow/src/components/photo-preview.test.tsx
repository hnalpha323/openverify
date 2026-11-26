import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { jpegBlob, pngFile } from '../testing/flow-fixtures';
import { renderWithI18n } from '../test-utils';
import { PhotoPreview } from './photo-preview';

const ALT = 'Your photo of the front of your ID';

describe('PhotoPreview', () => {
  it('shows the photo, described for screen readers', () => {
    renderWithI18n(
      <PhotoPreview photo={pngFile()} alt={ALT} onRetake={vi.fn()} onAccept={vi.fn()} />,
    );

    expect(screen.getByRole('img', { name: ALT })).toHaveAttribute(
      'src',
      expect.stringMatching(/^blob:/),
    );
    expect(
      screen.getByText(
        'Check that the photo is sharp, well lit and shows everything we asked for.',
      ),
    ).toBeVisible();
  });

  it('lets the user retake the photo or use it', async () => {
    const onRetake = vi.fn();
    const onAccept = vi.fn();
    renderWithI18n(
      <PhotoPreview photo={pngFile()} alt={ALT} onRetake={onRetake} onAccept={onAccept} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Retake' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this photo' }));

    expect(onRetake).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('releases the photo’s object URL when it is replaced or removed', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    try {
      const { rerender, unmount } = renderWithI18n(
        <PhotoPreview photo={pngFile()} alt={ALT} onRetake={vi.fn()} onAccept={vi.fn()} />,
      );
      const first = screen.getByRole('img').getAttribute('src');

      rerender(<PhotoPreview photo={jpegBlob()} alt={ALT} onRetake={vi.fn()} onAccept={vi.fn()} />);

      expect(revoke).toHaveBeenCalledWith(first);
      expect(screen.getByRole('img').getAttribute('src')).not.toBe(first);

      unmount();

      expect(revoke).toHaveBeenCalledTimes(2);
    } finally {
      revoke.mockRestore();
    }
  });

  it('is translated', () => {
    renderWithI18n(
      <PhotoPreview photo={pngFile()} alt={ALT} onRetake={vi.fn()} onAccept={vi.fn()} />,
      'es',
    );

    expect(screen.getByRole('button', { name: 'Usar esta foto' })).toBeEnabled();
  });
});
