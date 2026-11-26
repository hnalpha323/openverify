import type { FileResource, VerificationCheck } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  idComparisonOf,
  livenessEvidenceOf,
  posePhotos,
  type SelfieVerification,
} from '../lib/selfie-evidence';
import {
  SELFIE_IDS as IDS,
  selfieCapture,
  selfieChecks,
  selfieInquiryDocument,
  selfieVerification,
  supersededCapture,
} from '../testing/selfie-fixtures';
import {
  LivenessSummary,
  PromptTimings,
  SelfieCaptureDetails,
  SelfieCaptures,
  SelfiePhotos,
  SelfieScores,
  type SelfiePhotosProps,
} from './selfie-evidence';

const files = selfieInquiryDocument().included.filter(
  (resource): resource is FileResource => resource.type === 'file',
);
const selfieFiles = files.filter((file) => file.relationships.verification.data.id === IDS.selfie);
const front = files.find((file) => file.id === IDS.front);
const fileOfKind = (kind: string) => selfieFiles.find((file) => file.attributes.kind === kind);

/** The selfie with one check's result changed. */
function withCheck(name: string, change: Partial<VerificationCheck>): SelfieVerification {
  return selfieVerification({
    checks: selfieChecks().map((check) => (check.name === name ? { ...check, ...change } : check)),
  });
}

function photos(props: Partial<SelfiePhotosProps> = {}, verification = selfieVerification()) {
  return render(
    <SelfiePhotos
      label="Selfie"
      photos={posePhotos(['center', 'right', 'left'], selfieFiles)}
      media="visible"
      comparison={idComparisonOf(verification)}
      idFront={front}
      idImage="shown"
      {...props}
    />,
  );
}

const comparisonGroup = () =>
  screen.getByRole('group', { name: 'Compared with the government ID' });
const termValue = (scope: HTMLElement, term: string) =>
  within(scope).getByText(term, { selector: 'dt' }).nextElementSibling;

describe('SelfiePhotos (C47)', () => {
  it('shows the pose photos in prompt order, each labelled by its pose, through the file proxy', () => {
    photos();

    const list = screen.getByRole('list', { name: 'Selfie images' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => within(item).getAllByRole('img')[0]?.getAttribute('alt'))).toEqual([
      'Selfie, center',
      'Selfie, right',
      'Selfie, left',
    ]);
    expect(within(list).getByRole('img', { name: 'Selfie, right' })).toHaveAttribute(
      'src',
      `/files/${IDS.selfieRight}/rendition`,
    );
    expect(
      items.map((item) => within(item).getAllByText(/^Photo \d of 3$/)[0]?.textContent),
    ).toEqual(['Photo 1 of 3', 'Photo 2 of 3', 'Photo 3 of 3']);
    expect(within(items[1] ?? list).getByText('Right')).toBeVisible();
  });

  it('puts the government ID photo beside the centre photo, with the similarity, the threshold and its basis read from the result', () => {
    photos();

    const [center] = within(screen.getByRole('list', { name: 'Selfie images' })).getAllByRole(
      'listitem',
    );
    const group = comparisonGroup();
    expect(center).toContainElement(group);
    expect(
      within(group).getByRole('img', { name: 'Government ID front, whose portrait was compared' }),
    ).toHaveAttribute('src', `/files/${IDS.front}/rendition`);
    expect(termValue(group, 'Similarity')).toHaveTextContent('0.6512');
    expect(termValue(group, 'Threshold')).toHaveTextContent('0.371');
    expect(termValue(group, 'Threshold basis')).toHaveTextContent('Calibrated');
    expect(within(group).getByText('Passed')).toHaveAttribute('data-status', 'passed');
  });

  it('keeps the government ID photo in a closed disclosure on the card, where the ID card shows it', async () => {
    photos({ idImage: 'disclosed' });

    const summary = within(comparisonGroup()).getByText('Show the government ID photo');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details).toContainElement(
      screen.getByRole('img', { name: 'Government ID front, whose portrait was compared' }),
    );
    await userEvent.click(summary);
    expect(details).toHaveAttribute('open');
  });

  it('says a threshold without a basis was set by the template, and one without any basis is not recorded', () => {
    const { unmount } = photos(
      {},
      withCheck('selfie_id_comparison', {
        provenance: {
          'implementation-version': 2,
          thresholds: { threshold: 0.42 },
          'threshold-basis': {},
        },
      }),
    );
    expect(termValue(comparisonGroup(), 'Threshold')).toHaveTextContent('0.42');
    expect(termValue(comparisonGroup(), 'Threshold basis')).toHaveTextContent(
      'Set by the template',
    );
    unmount();

    photos(
      {},
      withCheck('selfie_id_comparison', {
        provenance: { 'implementation-version': 1, thresholds: { threshold: 0.363 } },
      }),
    );
    expect(termValue(comparisonGroup(), 'Threshold basis')).toHaveTextContent('Basis not recorded');
  });

  it.each([
    ['government_id', 'Nothing compared: the inquiry has no government ID to compare with.'],
    ['portrait', 'Nothing compared: no portrait was found on the government ID.'],
  ])('says why nothing was compared when the %s is missing', (missing, words) => {
    photos(
      { idFront: undefined },
      selfieVerification({
        'document-similarity-score': null,
        checks: selfieChecks().map((check) =>
          check.name === 'selfie_id_comparison'
            ? {
                ...check,
                status: 'not_applicable',
                reasons: ['no_reference_data'],
                metadata: { reference: missing },
              }
            : check,
        ),
      }),
    );

    const group = comparisonGroup();
    expect(within(group).getByText(words)).toBeVisible();
    expect(within(group).queryByRole('img')).not.toBeInTheDocument();
    expect(termValue(group, 'Similarity')).toHaveTextContent('Not measured');
  });

  it('gives the reasons in words when the comparison could not run, and says when it did not run at all', () => {
    const { unmount } = photos(
      {},
      withCheck('selfie_id_comparison', {
        status: 'not_applicable',
        reasons: ['input_missing'],
        metadata: {},
      }),
    );
    expect(within(comparisonGroup()).getByText('Input it needs is missing')).toBeVisible();
    unmount();

    photos({}, selfieVerification({ checks: [], 'document-similarity-score': null }));
    expect(within(comparisonGroup()).getByText('No ID comparison result.')).toBeVisible();
  });

  it('shows a missing photo, an unprompted one, and the file ids on the verification page', () => {
    render(
      <SelfiePhotos
        label="Selfie"
        photos={[
          { pose: 'center', file: fileOfKind('selfie-center'), prompted: true },
          { pose: 'left', file: undefined, prompted: true },
          { pose: 'right', file: fileOfKind('selfie-right'), prompted: false },
        ]}
        media="visible"
        idImage="shown"
        showFileIds
      />,
    );

    const items = within(screen.getByRole('list', { name: 'Selfie images' })).getAllByRole(
      'listitem',
    );
    expect(within(items[0] ?? document.body).getByText(IDS.selfieCenter)).toHaveClass('font-mono');
    expect(within(items[1] ?? document.body).getByText('No photo')).toBeVisible();
    expect(within(items[1] ?? document.body).getByText('Left')).toBeVisible();
    expect(within(items[2] ?? document.body).getByText('Not prompted')).toBeVisible();
    // Without the check details, no comparison is shown.
    expect(screen.queryByRole('group', { name: 'Compared with the government ID' })).toBeNull();
  });

  it('shows each prompted pose as "Hidden" when its files are not known (no inquiries:read), never as missing', () => {
    render(
      <SelfiePhotos
        label="Selfie"
        photos={[
          { pose: 'center', file: undefined, prompted: true },
          { pose: 'right', file: undefined, prompted: true },
        ]}
        media="hidden"
        hiddenExplanation="Your role cannot see these images (the inquiries:read permission)."
        idImage="shown"
        filesKnown={false}
      />,
    );

    const list = screen.getByRole('list', { name: 'Selfie images' });
    expect(within(list).queryByText('No photo')).not.toBeInTheDocument();
    const hidden = within(list).getAllByText('Hidden', { exact: true });
    expect(hidden).toHaveLength(2);
    expect(hidden[0]).toHaveAccessibleDescription(
      'Your role cannot see these images (the inquiries:read permission).',
    );
    expect(within(list).getByText('Photo 2 of 2')).toBeVisible();
  });

  it.each([
    ['hidden', 'Hidden'],
    ['redacted', 'Redacted'],
  ] as const)('shows %s photos as "%s", still labelled by pose', (media, words) => {
    photos({ media });

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Selfie images' });
    expect(within(list).getAllByText(words, { exact: true })).toHaveLength(4);
    expect(within(list).getByText('Center')).toBeVisible();
  });
});

describe('SelfieScores (C40.10, C47)', () => {
  it('lists the side similarities in prompt order and the passive liveness score, each with its threshold and basis', () => {
    render(<SelfieScores label="Selfie" evidence={livenessEvidenceOf(selfieVerification())} />);

    const table = screen.getByRole('table', { name: 'Selfie scores' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Score', 'Value', 'Threshold', 'Threshold basis']);
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      );
    const headers = within(table)
      .getAllByRole('rowheader')
      .map((header) => header.textContent);
    expect(headers).toEqual([
      'Similarity of the right pose to the center',
      'Similarity of the left pose to the center',
      'Passive liveness score of the center',
    ]);
    expect(rows).toEqual([
      ['0.8123', '0.45', 'Set by the template'],
      ['0.7954', '0.45', 'Set by the template'],
      ['0.8811', '0.55', 'Provisional'],
    ]);
  });

  it('says a score that was not measured, and a threshold that was not recorded', () => {
    render(
      <SelfieScores
        label="Selfie"
        evidence={livenessEvidenceOf(
          selfieVerification({ checks: [], 'liveness-score': null, poses: ['center', 'left'] }),
        )}
      />,
    );

    const row = screen.getAllByRole('row')[1];
    expect(
      within(row ?? document.body)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['0.7954', 'Not recorded', 'Not recorded']);
    expect(screen.getAllByRole('row')[2]).toHaveTextContent('Not measured');
  });
});

describe('LivenessSummary (C43, C47)', () => {
  it('shows each component with its status in words', () => {
    render(<LivenessSummary label="Selfie" evidence={livenessEvidenceOf(selfieVerification())} />);

    const group = screen.getByRole('group', { name: 'Selfie liveness' });
    expect(termValue(group, 'Passive')).toHaveTextContent('Passed');
    expect(termValue(group, 'Active')).toHaveTextContent('Passed');
    expect(termValue(group, 'Integrity')).toHaveTextContent('Not run');
    expect(within(group).getAllByText('Passed')[0]).toHaveAttribute('data-status', 'passed');
    expect(termValue(group, 'Prompt order')).toHaveTextContent('In the prompted order');
    expect(termValue(group, 'Side poses judged')).toHaveTextContent('Right, Left');
  });

  it('lists every recorded flag in words, with its code', () => {
    render(<LivenessSummary label="Selfie" evidence={livenessEvidenceOf(selfieVerification())} />);

    const flags = screen.getByRole('list', { name: 'Selfie liveness flags' });
    const items = within(flags)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toEqual([
      'The camera label is a file pathfile-path-label',
      'The browser was under automation (webdriver)webdriver',
      'Poses arrived together, not one by oneuploads-batched',
      expect.stringMatching(/^Sandbox test captureIn a sandbox, .+test-capture-device$/),
    ]);
  });

  it('shows a flag and a status it has no words for as their codes, in monospace', () => {
    render(
      <LivenessSummary
        label="Selfie"
        evidence={livenessEvidenceOf(
          withCheck('selfie_liveness_detection', {
            metadata: {
              components: { passive: 'a_status_from_the_future' },
              'integrity-flags': ['a-flag-from-the-future'],
            },
          }),
        )}
      />,
    );

    expect(screen.getByText('a_status_from_the_future')).toHaveClass('font-mono');
    expect(screen.getByText('a-flag-from-the-future')).toHaveClass('font-mono');
    expect(termValue(screen.getByRole('group'), 'Active')).toHaveTextContent('Not recorded');
    expect(termValue(screen.getByRole('group'), 'Prompt order')).toHaveTextContent('Not recorded');
  });

  it('says there is no flag, and when liveness did not run', () => {
    const { unmount } = render(
      <LivenessSummary
        label="Selfie"
        evidence={livenessEvidenceOf(
          withCheck('selfie_liveness_detection', {
            metadata: { components: {}, 'order-followed': null, 'judged-poses': [] },
          }),
        )}
      />,
    );
    expect(screen.getByText('No flag recorded.')).toBeVisible();
    expect(termValue(screen.getByRole('group'), 'Prompt order')).toHaveTextContent(
      'Order could not be told',
    );
    expect(termValue(screen.getByRole('group'), 'Side poses judged')).toHaveTextContent('None');
    unmount();

    render(
      <LivenessSummary
        label="Selfie"
        evidence={livenessEvidenceOf(selfieVerification({ checks: [] }))}
      />,
    );
    expect(screen.getByText('Liveness did not run.')).toBeVisible();
  });
});

describe('PromptTimings (C40.1, C47)', () => {
  it('lists each pose with the client elapsed time and the server receipt time', () => {
    render(<PromptTimings label="Selfie" capture={selfieCapture()} />);

    const table = screen.getByRole('table', { name: 'Selfie prompt timings' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Pose', 'Client time (ms)', 'Received (UTC)']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(['Center', 'Right', 'Left']);
    const first = within(table).getAllByRole('row')[1] ?? table;
    expect(within(first).getByText('4,200')).toBeVisible();
    expect(within(first).getByText('Oct 20, 2026, 4:37 AM')).toHaveAttribute(
      'datetime',
      '2026-10-20T04:37:05.000Z',
    );
  });

  it('says a client time that was not sent, a capture without photos, and a selfie without a capture', () => {
    const { unmount } = render(
      <PromptTimings
        label="Selfie"
        capture={selfieCapture({
          'prompt-timings': [
            {
              pose: 'center',
              'client-elapsed-ms': null,
              'received-at': '2026-10-20T04:37:05.000Z',
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole('row', { name: /Center/ })).toHaveTextContent('Not sent');
    unmount();

    const { unmount: second } = render(
      <PromptTimings label="Selfie" capture={selfieCapture({ 'prompt-timings': [] })} />,
    );
    expect(screen.getByText('No photo was received.')).toBeVisible();
    second();

    render(<PromptTimings label="Selfie" capture={undefined} />);
    expect(
      screen.getByText('No capture: this selfie was taken without the capture protocol.'),
    ).toBeVisible();
  });
});

describe('SelfieCaptureDetails (C40.10)', () => {
  it('names the capture method and the liveness mode, or that they were not recorded', () => {
    const { unmount } = render(
      <dl>
        <SelfieCaptureDetails verification={selfieVerification()} />
      </dl>,
    );
    expect(screen.getByText('Capture method').nextElementSibling).toHaveTextContent('Camera');
    expect(screen.getByText('Liveness').nextElementSibling).toHaveTextContent(
      'Active (head turns)',
    );
    unmount();

    render(
      <dl>
        <SelfieCaptureDetails
          verification={selfieVerification({ 'capture-method': null, liveness: null })}
        />
      </dl>,
    );
    expect(screen.getByText('Capture method').nextElementSibling).toHaveTextContent('Not recorded');
    expect(screen.getByText('Liveness').nextElementSibling).toHaveTextContent('Not recorded');
  });
});

describe('SelfieCaptures (C40.1, C47)', () => {
  const open = selfieCapture(
    {
      status: 'initiated',
      'prompt-timings': [],
      'submitted-at': null,
      'processed-at': null,
      'created-at': '2026-10-20T04:38:00.000Z',
      'expires-at': '2026-10-20T04:41:00.000Z',
    },
    'self_01JB0000000000000000000012',
  );

  it('lists the captures as given (newest first) with method, status, outcome in words and times', () => {
    render(
      <SelfieCaptures
        caption="Selfie captures"
        captures={[open, selfieCapture(), supersededCapture()]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Selfie captures' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Capture ID',
      'Method',
      'Status',
      'Outcome',
      'Created (UTC)',
      'Expires (UTC)',
      'Submitted (UTC)',
    ]);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual([open.id, IDS.capture, IDS.supersededCapture]);
    const row = (id: string) => screen.getByRole('row', { name: new RegExp(id) });
    expect(within(row(open.id)).getByText('Open')).toHaveAttribute('data-status', 'initiated');
    expect(row(open.id)).toHaveTextContent('Not submitted yet');
    expect(within(row(IDS.capture)).getByText('Processed')).toHaveAttribute(
      'data-status',
      'processed',
    );
    expect(row(IDS.capture)).toHaveTextContent('Used for the checks');
    expect(row(IDS.capture)).toHaveTextContent('Camera');
    const superseded = row(IDS.supersededCapture);
    expect(within(superseded).getByText('Errored')).toHaveAttribute('data-status', 'errored');
    expect(within(superseded).getByText('Superseded')).toBeVisible();
    expect(
      within(superseded).getByText('A newer capture replaced it before it was submitted.'),
    ).toBeVisible();
    expect(within(superseded).getByText('superseded')).toHaveClass('font-mono');
    // Never submitted: no submission time.
    expect(within(superseded).getByText('None')).toHaveClass('sr-only');
  });

  it.each([
    [{ status: 'submitted' as const, 'processed-at': null }, 'Submitted; the checks are running'],
    [
      { status: 'errored' as const, 'error-code': 'processing_failed' as const },
      'Processing failed',
    ],
    [{ status: 'errored' as const, 'error-code': null }, 'No reason recorded'],
  ])('says the outcome of a capture that is %o', (attributes, words) => {
    render(<SelfieCaptures caption="Captures" captures={[selfieCapture(attributes)]} />);

    expect(screen.getByRole('row', { name: new RegExp(IDS.capture) })).toHaveTextContent(words);
  });

  it('names and links each capture’s verification on the inquiry page', () => {
    const { unmount } = render(
      <SelfieCaptures
        caption="Selfie captures"
        captures={[selfieCapture()]}
        verificationColumn="linked"
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Verification' })).toBeVisible();
    expect(screen.getByRole('link', { name: IDS.selfie })).toHaveAttribute(
      'href',
      `/verifications/${IDS.selfie}`,
    );
    unmount();

    render(
      <SelfieCaptures
        caption="Selfie captures"
        captures={[selfieCapture()]}
        verificationColumn="plain"
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(IDS.selfie)).toHaveClass('font-mono');
  });
});
