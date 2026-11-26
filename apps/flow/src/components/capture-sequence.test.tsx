import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/locales/en';
import { fr } from '../i18n/locales/fr';
import { cameraDeliversFrame, fakeCamera } from '../testing/fake-camera';
import type { PhotoProblem } from '../lib/photo-check';
import { jpegBlob, pngFile } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { CaptureSequence, type CaptureMethod, type CaptureShot } from './capture-sequence';

function shot(kind: 'front' | 'back', methods: readonly CaptureMethod[] = ['upload', 'camera']) {
  const side = kind === 'front' ? 'Front' : 'Back';
  return {
    kind,
    title: `${side} of your ID`,
    instruction: `Fit the ${kind} inside the frame.`,
    previewAlt: `Your photo of the ${kind}`,
    uploadLabel: `Choose a photo of the ${kind}`,
    methods,
    camera: { facingMode: 'environment', guide: 'document', mirrored: false },
  } satisfies CaptureShot;
}

function renderSequence(
  shots: readonly CaptureShot[],
  camera = fakeCamera(),
  language: 'en' | 'fr' = 'en',
) {
  const onComplete = vi.fn();
  renderWithFlow(<CaptureSequence shots={shots} onComplete={onComplete} />, {
    environment: camera.environment,
    language,
  });
  return { onComplete, camera };
}

const SHARP = {
  photo: jpegBlob(),
  width: 3000,
  height: 4000,
  check: { guideWidthPx: 2550, sharpness: 0.9, problem: null },
} as const;

/** A camera whose document photos the check calls `problem`. */
function cameraWithProblem(problem: PhotoProblem) {
  const camera = fakeCamera();
  camera.captureDocument.mockImplementation(() =>
    Promise.resolve({ ...SHARP, photo: jpegBlob(), check: { ...SHARP.check, problem } }),
  );
  return camera;
}

async function takePhoto() {
  await cameraDeliversFrame();
  await userEvent.click(screen.getByRole('button', { name: 'Capture' }));
}

async function upload(kind: 'front' | 'back', file: File = pngFile()) {
  await userEvent.upload(screen.getByLabelText(`Choose a photo of the ${kind}`), file);
}

describe('CaptureSequence', () => {
  it('introduces the first photo and offers each allowed method', () => {
    renderSequence([shot('front'), shot('back')]);

    expect(screen.getByText('Photo 1 of 2')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Front of your ID' })).toBeVisible();
    expect(screen.getByText('Fit the front inside the frame.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeEnabled();
  });

  it('offers only the methods the step allows', () => {
    renderSequence([shot('front', ['upload'])]);

    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Take a photo' })).not.toBeInTheDocument();
  });

  it('hides the file picker when uploads are not allowed', () => {
    renderSequence([shot('front', ['camera'])]);

    expect(screen.queryByRole('button', { name: 'Upload a photo' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a photo of the front')).not.toBeInTheDocument();
  });

  it('does not count photos when only one is needed', () => {
    renderSequence([shot('front')]);

    expect(screen.queryByText(/Photo 1 of/)).not.toBeInTheDocument();
  });

  it('keeps the file picker out of the accessibility tree, behind the upload button', () => {
    renderSequence([shot('front')]);

    // One control per method for assistive tech: the button, not a second, unlabelled input.
    expect(screen.getByLabelText('Choose a photo of the front')).not.toBeVisible();
  });

  it('opens the file picker from the upload button', async () => {
    renderSequence([shot('front')]);
    const input = screen.getByLabelText<HTMLInputElement>('Choose a photo of the front');
    const click = vi.spyOn(input, 'click');

    await userEvent.click(screen.getByRole('button', { name: 'Upload a photo' }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });

  it('previews an uploaded photo, then moves to the next one', async () => {
    renderSequence([shot('front'), shot('back')]);

    await upload('front');

    expect(await screen.findByRole('img', { name: 'Your photo of the front' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Use this photo' }));

    expect(screen.getByText('Photo 2 of 2')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Back of your ID' })).toHaveFocus();
  });

  it('refuses a file that is not a supported image, whatever it claims to be', async () => {
    renderSequence([shot('front')]);

    await upload('front', new File(['%PDF-1.7'], 'id.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      en.capture.fileErrors['unsupported-type'],
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('clears a file error once a good photo is chosen', async () => {
    renderSequence([shot('front')]);
    await upload('front', new File([], 'empty.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.capture.fileErrors.empty);

    await upload('front');

    expect(await screen.findByRole('img')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('returns to the choice of method when an uploaded photo is retaken', async () => {
    renderSequence([shot('front')]);
    await upload('front');

    await userEvent.click(await screen.findByRole('button', { name: 'Retake' }));

    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeVisible();
  });

  it('takes a photo with the camera and goes back to the camera on retake', async () => {
    const { camera } = renderSequence([shot('front')]);

    await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    await cameraDeliversFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(await screen.findByRole('img', { name: 'Your photo of the front' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Retake' }));

    expect(await screen.findByLabelText('Camera preview')).toBeInTheDocument();
    expect(camera.requestCamera).toHaveBeenCalledTimes(2);
  });

  it('goes back to the choice of method when the camera is cancelled', async () => {
    renderSequence([shot('front')]);
    await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeVisible();
  });

  describe('focus and announcements (F016)', () => {
    it('moves focus to the photo title when the camera opens', async () => {
      renderSequence([shot('front')]);

      await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));

      expect(screen.getByRole('heading', { level: 2, name: 'Front of your ID' })).toHaveFocus();
    });

    it('moves focus to the photo title and announces the photo to check', async () => {
      renderSequence([shot('front')]);
      const status = screen.getByTestId('capture-announcement');
      expect(status).toHaveAttribute('role', 'status');
      expect(status).toHaveTextContent('');

      await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
      await cameraDeliversFrame();
      await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

      await screen.findByRole('img', { name: 'Your photo of the front' });
      expect(screen.getByRole('heading', { level: 2, name: 'Front of your ID' })).toHaveFocus();
      expect(status).toHaveTextContent(en.capture.photoReady);
    });

    it('returns focus to Take a photo when the camera is cancelled', async () => {
      renderSequence([shot('front')]);
      await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));

      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

      expect(screen.getByRole('button', { name: 'Take a photo' })).toHaveFocus();
    });

    it('returns focus to Upload a photo when an uploaded photo is retaken', async () => {
      renderSequence([shot('front')]);
      await upload('front');

      await userEvent.click(await screen.findByRole('button', { name: 'Retake' }));

      expect(screen.getByRole('button', { name: 'Upload a photo' })).toHaveFocus();
    });
  });

  it('hands over every photo, in order, once the last one is accepted', async () => {
    const camera = fakeCamera();
    const back = jpegBlob();
    camera.captureDocument.mockResolvedValue({ ...SHARP, photo: back });
    const front = pngFile();
    const { onComplete } = renderSequence([shot('front'), shot('back')], camera);

    await upload('front', front);
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    await cameraDeliversFrame();
    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith([
      ['front', front],
      ['back', back],
    ]);
  });
  describe('the photo check before upload (Phase 12A F3)', () => {
    it.each(['blurry', 'too-small'] as const)(
      'asks for a retake of a %s photo and does not offer to send it',
      async (problem) => {
        const { onComplete } = renderSequence([shot('front')], cameraWithProblem(problem));
        await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));

        await takePhoto();

        expect(await screen.findByRole('alert')).toHaveTextContent(en.capture.photoCheck[problem]);
        expect(screen.queryByRole('button', { name: 'Use this photo' })).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: en.capture.photoCheck.useAnyway }),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId('capture-announcement')).toHaveTextContent('');
        await userEvent.click(screen.getByRole('button', { name: 'Retake' }));
        expect(await screen.findByLabelText('Camera preview')).toBeInTheDocument();
        expect(onComplete).not.toHaveBeenCalled();
      },
    );

    it('offers to use the photo anyway after two prompts for the same side', async () => {
      const camera = cameraWithProblem('blurry');
      const { onComplete } = renderSequence([shot('front'), shot('back')], camera);
      await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));

      for (let prompt = 1; prompt <= 2; prompt += 1) {
        await takePhoto();
        await screen.findByRole('alert');
        expect(
          screen.queryByRole('button', { name: en.capture.photoCheck.useAnyway }),
        ).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Retake' }));
      }
      await takePhoto();
      await userEvent.click(
        await screen.findByRole('button', { name: en.capture.photoCheck.useAnyway }),
      );

      // The back starts its own count.
      expect(await screen.findByRole('heading', { name: 'Back of your ID' })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
      await takePhoto();
      await screen.findByRole('alert');
      expect(
        screen.queryByRole('button', { name: en.capture.photoCheck.useAnyway }),
      ).not.toBeInTheDocument();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('keeps the count when the camera is cancelled and opened again', async () => {
      renderSequence([shot('front')], cameraWithProblem('too-small'));

      for (let prompt = 1; prompt <= 2; prompt += 1) {
        await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
        await takePhoto();
        await userEvent.click(await screen.findByRole('button', { name: 'Retake' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      }
      await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
      await takePhoto();

      expect(
        await screen.findByRole('button', { name: en.capture.photoCheck.useAnyway }),
      ).toBeVisible();
    });

    it('sends a photo that passes the check as before', async () => {
      const camera = fakeCamera();
      camera.captureDocument.mockResolvedValue(SHARP);
      const { onComplete } = renderSequence([shot('front')], camera);
      await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));

      await takePhoto();
      await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(onComplete).toHaveBeenCalledWith([['front', SHARP.photo]]);
    });

    it('is translated', async () => {
      renderSequence([shot('front')], cameraWithProblem('blurry'), 'fr');
      await userEvent.click(screen.getByRole('button', { name: fr.capture.takePhoto }));

      fireEvent.loadedData(await screen.findByLabelText(fr.capture.preview));
      await userEvent.click(screen.getByRole('button', { name: fr.capture.shutter }));

      expect(await screen.findByRole('alert')).toHaveTextContent(fr.capture.photoCheck.blurry);
    });
  });
});
