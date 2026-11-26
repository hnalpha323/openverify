import type { RetryHint } from '@openverify/contracts';
import type { Flow } from '@openverify/flow-spec';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { wholeText } from '../../testing/flow-renderer';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../../api/flow-api-client';
import type { DocumentStep as DocumentFlowStep, FlowPosition } from '../../flow/flow-position';
import { FakeFlowApi } from '../../testing/fake-flow-api';
import {
  JPEG_BYTES,
  PDF_BYTES,
  flowVerification,
  pdfFile,
  pngFile,
} from '../../testing/flow-fixtures';
import { renderWithFlow } from '../../test-utils';
import { DocumentStep } from './document-step';

type CapturePosition = Extract<FlowPosition, { kind: 'capture' }> & { step: DocumentFlowStep };

const BILLS: DocumentFlowStep = {
  id: 'proof',
  type: 'document',
  documentTypes: ['utility_bill', 'bank_statement', 'lease', 'tax_document'],
  captureMethods: ['upload', 'camera'],
};

const UPLOAD_ONLY: DocumentFlowStep = { ...BILLS, captureMethods: ['upload'] };

/** C52.2: the guidance of a document verification (synthetic). */
const GUIDANCE = {
  'accepted-types': ['utility_bill', 'bank_statement', 'lease', 'tax_document'],
  'max-age-days': 90,
  'max-pages': 50,
  'accepted-mime-types': ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
};

const TOO_OLD: RetryHint = { name: 'document_recency_detection', reasons: ['document_too_old'] };

const FORMATS = 'Upload it as a PDF, JPEG, PNG, or WebP file of up to 10 MB.';

function flowWith(step: DocumentFlowStep): Flow {
  return {
    metadata: { specVersion: 1, id: 'proof', version: 1, name: 'Proof' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      step,
      { id: 'done', type: 'completion' },
    ],
    transitions: [],
  };
}

/**
 * The step's screen. `resumed` puts an initiated attempt in the fake (with `guidance`, or the
 * fake's own) and resumes it, as the session would; otherwise the screen makes its attempt.
 */
function renderStep(
  step: DocumentFlowStep,
  {
    api = new FakeFlowApi(),
    resumed = false,
    guidance,
    hints = [],
    language = 'en',
  }: {
    api?: FakeFlowApi;
    resumed?: boolean;
    guidance?: unknown;
    hints?: RetryHint[];
    language?: 'en' | 'es';
  } = {},
) {
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  api.flow = flowWith(step);
  if (guidance !== undefined) {
    api.guidanceOf.document = guidance;
  }
  let position: CapturePosition = {
    kind: 'capture',
    step,
    attempt: 1,
    maxAttempts: 3,
    verificationId: null,
    hints,
  };
  if (resumed) {
    const id = 'ver_01M5CK16P0D13FXHZSS4TCFBV0';
    api.verifications.push({ type: 'document', status: 'initiated', id, hints: [] });
    position = {
      ...position,
      verificationId: id,
      verification: flowVerification('document', 'initiated', {
        id,
        ...(guidance === undefined || guidance === null ? {} : { guidance }),
      }),
    };
  }
  const onSubmitted = vi.fn(() => Promise.resolve());
  renderWithFlow(
    <DocumentStep position={position} client={api.client} onSubmitted={onSubmitted} />,
    {
      language,
    },
  );
  return { api, onSubmitted };
}

const fileInput = () => screen.getByLabelText('Choose a file of your document');
const cameraInput = () => screen.queryByLabelText('Take a photo of your document');

/** A file of `size` bytes whose first bytes are `head`, without allocating the rest. */
function fileOfSize(size: number, head: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  const file = new File([head], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function httpError(status: number, path = '/files'): FlowApiError {
  return new FlowApiError('http', `POST ${path} failed with HTTP ${String(status)}`, { status });
}

describe('DocumentStep (C60, C64.1)', () => {
  it('asks for one of the accepted documents, each with the window the guidance gives', () => {
    renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    expect(screen.getByRole('heading', { level: 1, name: 'Upload a document' })).toBeVisible();
    expect(screen.getByText('Attempt 1 of 3')).toBeVisible();
    const accepted = screen.getByRole('list', { name: 'You can upload one of these:' });
    expect(
      within(accepted)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'A utility bill dated within the last 90 days',
      'A bank statement dated within the last 90 days',
      'A lease or rental agreement that is still in force',
      'A tax document from the latest tax year',
    ]);
    expect(screen.getByText(FORMATS)).toBeVisible();
    expect(screen.getByText('A PDF can have up to 50 pages.')).toBeVisible();
  });

  it('says one day or one page in the singular', () => {
    renderStep(UPLOAD_ONLY, {
      resumed: true,
      guidance: { ...GUIDANCE, 'accepted-types': ['pay_stub'], 'max-age-days': 1, 'max-pages': 1 },
    });

    expect(screen.getByRole('listitem')).toHaveTextContent('A pay stub dated within the last day');
    expect(screen.getByText('A PDF can have only 1 page.')).toBeVisible();
  });

  it('reads the guidance of the attempt it makes when the screen opens (C52.2)', async () => {
    const { api } = renderStep(BILLS);

    expect(await screen.findByText('A utility bill dated within the last 90 days')).toBeVisible();
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
    expect(api.client.createVerification).toHaveBeenCalledWith({ type: 'document' }, undefined);
  });

  it('names the step’s own documents, without a window, while no guidance is known', async () => {
    const { api } = renderStep(BILLS, { guidance: null });

    await waitFor(() => {
      expect(api.client.getVerification).toHaveBeenCalled();
    });
    expect(
      within(screen.getByRole('list'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'A utility bill',
      'A bank statement',
      'A lease or rental agreement',
      'A tax document',
    ]);
    expect(screen.getByText(FORMATS)).toBeVisible();
  });

  it('takes only the accepted media types, and a photo from the back camera when the step allows it', () => {
    renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    expect(fileInput()).toHaveAttribute(
      'accept',
      'application/pdf,image/jpeg,image/png,image/webp',
    );
    expect(fileInput()).not.toHaveAttribute('capture');
    expect(cameraInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(cameraInput()).toHaveAttribute('capture', 'environment');
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeVisible();
  });

  it('offers no camera for an upload-only step, nor when the guidance accepts no image', () => {
    renderStep(UPLOAD_ONLY, { resumed: true, guidance: GUIDANCE });
    expect(cameraInput()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take a photo' })).not.toBeInTheDocument();
  });

  it('offers no camera when the guidance accepts PDFs only, and says so', () => {
    renderStep(BILLS, {
      resumed: true,
      guidance: { ...GUIDANCE, 'accepted-mime-types': ['application/pdf'] },
    });

    expect(cameraInput()).not.toBeInTheDocument();
    expect(fileInput()).toHaveAttribute('accept', 'application/pdf');
    expect(screen.getByText('Upload it as a PDF file of up to 10 MB.')).toBeVisible();
  });

  it('shows a picked file by its name and size only, never its contents, and moves focus to it', async () => {
    renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    await userEvent.upload(fileInput(), pdfFile('statement.pdf'));

    const summary = await screen.findByText(
      wholeText(`Your file: statement.pdf, ${String(PDF_BYTES.length)} bytes`),
    );
    expect(summary).toHaveFocus();
    // C64.1: a PDF is never rendered, and no preview of the file is made.
    expect(document.querySelector('img, iframe, object, embed, canvas, video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload this file' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeVisible();
  });

  it('uploads the picked document as its sniffed type, submits it, then reads the session', async () => {
    const { api, onSubmitted } = renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    await userEvent.upload(fileInput(), pdfFile('statement.pdf'));
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.uploads.map(({ kind, file }) => [kind, file.type, file.size])).toEqual([
      ['document', 'application/pdf', PDF_BYTES.length],
    ]);
    expect(api.submits.map(({ verificationId }) => verificationId)).toEqual([
      'ver_01M5CK16P0D13FXHZSS4TCFBV0',
    ]);
    expect(api.client.createVerification).not.toHaveBeenCalled();
  });

  // C153.2 (Workflow 9A): the upload says how the document was captured (client-reported), and the
  // step offers the methods of this device class.
  it('reports a picked file as an upload and a photo as taken with the camera', async () => {
    const { api } = renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    await userEvent.upload(fileInput(), pdfFile('statement.pdf'));
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    await waitFor(() => {
      expect(api.client.uploadFile).toHaveBeenCalledWith(
        'ver_01M5CK16P0D13FXHZSS4TCFBV0',
        'document',
        expect.any(Blob),
        expect.any(AbortSignal),
        undefined,
        'upload',
      );
    });
  });

  it('reports a photo taken with the camera input as camera', async () => {
    const { api } = renderStep(BILLS, { resumed: true, guidance: GUIDANCE });
    const input = cameraInput();
    if (input === null) {
      throw new Error('no camera input');
    }

    await userEvent.upload(input, pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    await waitFor(() => {
      expect(api.client.uploadFile).toHaveBeenCalledWith(
        'ver_01M5CK16P0D13FXHZSS4TCFBV0',
        'document',
        expect.any(Blob),
        expect.any(AbortSignal),
        undefined,
        'camera',
      );
    });
  });

  it('offers only the methods of its device class entry', () => {
    renderWithFlow(
      <DocumentStep
        position={{
          kind: 'capture',
          step: {
            ...BILLS,
            captureMethodsByDevice: { 'desktop-web': ['upload'] },
          } as DocumentFlowStep,
          attempt: 1,
          maxAttempts: 3,
          verificationId: null,
          hints: [],
        }}
        client={new FakeFlowApi().client}
        onSubmitted={vi.fn(() => Promise.resolve())}
      />,
      { environment: { deviceKind: 'desktop-web' } },
    );

    expect(cameraInput()).not.toBeInTheDocument();
  });

  // Workflow 5C review P023 (WCAG 4.1.3): while the document goes up, a live region says so.
  it('says the upload is under way in a status region while it lasts', async () => {
    const { api, onSubmitted } = renderStep(BILLS, { resumed: true, guidance: GUIDANCE });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upload = api.client.uploadFile.getMockImplementation();
    api.client.uploadFile.mockImplementationOnce(async (...args) => {
      await held;
      if (upload === undefined) {
        throw new Error('the fake has no upload');
      }
      return upload(...args);
    });

    await userEvent.upload(fileInput(), pdfFile('statement.pdf'));
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Uploading your document…');
    expect(onSubmitted).not.toHaveBeenCalled();
    release();
    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it('takes a photo with the camera and sends it the same way', async () => {
    const { api, onSubmitted } = renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    const photo = new File([JPEG_BYTES], 'image.jpg', { type: 'image/jpeg' });
    const camera = cameraInput();
    expect(camera).not.toBeNull();
    if (camera === null) {
      return;
    }
    await userEvent.upload(camera, photo);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.uploads.map(({ kind, file }) => [kind, file.type])).toEqual([
      ['document', 'image/jpeg'],
    ]);
  });

  it('lets the user replace the picked file before uploading it', async () => {
    const { api } = renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    await userEvent.upload(fileInput(), pdfFile('old.pdf'));
    expect(await screen.findByText(wholeText(/^Your file: old\.pdf/u))).toBeVisible();
    await userEvent.upload(fileInput(), pdfFile('new.pdf'));

    expect(await screen.findByText(wholeText(/^Your file: new\.pdf/u))).toBeVisible();
    expect(screen.queryByText(wholeText(/old\.pdf/u))).not.toBeInTheDocument();
    expect(api.uploads).toEqual([]);
  });

  it('refuses a file whose bytes are not an accepted type, before sending anything', async () => {
    const { api } = renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    await userEvent.upload(
      fileInput(),
      new File([new TextEncoder().encode('plain text')], 'bill.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We cannot use this type of file. Choose a PDF, JPEG, PNG, or WebP file.',
    );
    expect(screen.queryByRole('button', { name: 'Upload this file' })).not.toBeInTheDocument();
    expect(api.uploads).toEqual([]);
  });

  it('refuses a file over 10 MB and an empty one, before sending anything', async () => {
    const { api } = renderStep(BILLS, { resumed: true, guidance: GUIDANCE });

    await userEvent.upload(
      fileInput(),
      fileOfSize(10 * 1024 * 1024 + 1, PDF_BYTES, 'big.pdf', 'application/pdf'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This file is larger than 10 MB. Choose a smaller file, such as a photo of the document or a PDF with fewer pages.',
    );

    await userEvent.upload(fileInput(), new File([], 'empty.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This file is empty. Choose another file.',
    );
    expect(api.uploads).toEqual([]);
  });

  it.each([
    [413, 'This file is larger than 10 MB.'],
    [415, 'We cannot use this type of file.'],
    [422, 'We cannot use this type of file.'],
  ])(
    'shows the server’s %d refusal of the file and lets the user pick another',
    async (status, message) => {
      const api = new FakeFlowApi();
      api.failures.uploadFile = [httpError(status)];
      const { onSubmitted } = renderStep(BILLS, { api, resumed: true, guidance: GUIDANCE });

      await userEvent.upload(fileInput(), pdfFile());
      await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Upload this file' })).not.toBeInTheDocument();

      await userEvent.upload(fileInput(), pdfFile());
      await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));
      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });
    },
  );

  it('reads the session again when the attempt moved on at the server (409)', async () => {
    const api = new FakeFlowApi();
    api.failures.uploadFile = [httpError(409)];
    const { onSubmitted } = renderStep(BILLS, { api, resumed: true, guidance: GUIDANCE });

    await userEvent.upload(fileInput(), pdfFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.submits).toEqual([]);
  });

  it('offers Try again after a server error, then submits without uploading the file again', async () => {
    const api = new FakeFlowApi();
    api.failures.submitVerification = [httpError(503, '/submit')];
    const { onSubmitted } = renderStep(BILLS, { api, resumed: true, guidance: GUIDANCE });

    await userEvent.upload(fileInput(), pdfFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The verification service is having trouble. Try again in a few minutes.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.uploads).toHaveLength(1);
    expect(api.submits).toHaveLength(1);
  });

  it('makes the attempt’s verification when sending if the screen could not make it on opening', async () => {
    const api = new FakeFlowApi();
    api.failures.createVerification = [httpError(503, '/verifications')];
    const { onSubmitted } = renderStep(BILLS, { api });

    await waitFor(() => {
      expect(api.client.createVerification).toHaveBeenCalledTimes(1);
    });
    // Nothing is said about it: the step's own documents are named meanwhile.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('A utility bill')).toBeVisible();

    await userEvent.upload(fileInput(), pdfFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Upload this file' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
      ['document', 'submitted'],
    ]);
  });

  it('says why the last attempt failed, as an attempt rather than as photos', () => {
    renderStep(BILLS, { resumed: true, guidance: GUIDANCE, hints: [TOO_OLD] });

    const hint = screen.getByRole('alert');
    expect(hint).toHaveTextContent('Your last attempt did not go through');
    expect(hint).toHaveTextContent('Your document is too old. Upload a more recent one.');
  });

  it('speaks Spanish', async () => {
    renderStep(BILLS, { resumed: true, guidance: GUIDANCE, language: 'es' });

    expect(screen.getByRole('heading', { level: 1, name: 'Sube un documento' })).toBeVisible();
    expect(
      screen.getByText('Una factura de servicios con fecha de los últimos 90 días'),
    ).toBeVisible();
    expect(
      screen.getByText('Súbelo como archivo PDF, JPEG, PNG o WebP de hasta 10 MB.'),
    ).toBeVisible();
    await userEvent.upload(screen.getByLabelText('Elige un archivo de tu documento'), pdfFile());
    expect(
      await screen.findByText(
        wholeText(`Tu archivo: statement.pdf, ${String(PDF_BYTES.length)} bytes`),
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Subir este archivo' })).toBeVisible();
  });
});
