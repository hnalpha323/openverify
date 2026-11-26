import type { VerificationCheck } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CheckResults, type CheckResultsProps } from './check-results';

const SHA256 = 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0';

/** A synthetic government ID's checks, out of order on purpose (Phase 3 shape, C29.2). */
const CHECKS: VerificationCheck[] = [
  {
    name: 'id_glare_detection',
    status: 'passed',
    reasons: [],
    requirement: 'required',
    metadata: { glare_ratio: 0.004 },
    stage: 'ga',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: { 'max-glare-ratio': 0.05 } },
  },
  {
    name: 'id_tamper_detection',
    status: 'passed',
    reasons: [],
    requirement: 'not_required',
    metadata: { score: 0.21 },
    stage: 'beta',
    confidence: 0.58,
    provenance: { 'implementation-version': 1, thresholds: { 'max-tamper-score': 0.5 } },
  },
  {
    name: 'id_repeat_detection',
    status: 'failed',
    reasons: ['id_repeat_detected'],
    requirement: 'not_required',
    metadata: {},
    stage: 'ga',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: {} },
  },
  {
    name: 'id_public_figure_detection',
    status: 'not_applicable',
    reasons: ['provider_not_configured'],
    requirement: 'required',
    metadata: {},
    stage: 'beta',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: {} },
  },
  {
    name: 'id_barcode_detection',
    status: 'not_applicable',
    reasons: ['feature_absent'],
    requirement: 'required',
    metadata: {},
    stage: 'ga',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: {} },
  },
  {
    name: 'id_portrait_detection',
    status: 'passed',
    reasons: [],
    requirement: 'required',
    metadata: { score: 0.93 },
    stage: 'beta',
    confidence: null,
    provenance: {
      'implementation-version': 2,
      models: [{ id: 'yunet-2026may', sha256: SHA256 }],
      thresholds: { 'required-fields': ['name-first', 'birthdate'], 'strict-mode': true },
    },
  },
  {
    name: 'id_age_inconsistency_detection',
    status: 'passed',
    reasons: [],
    requirement: 'not_required',
    metadata: {},
    stage: 'beta',
    confidence: 0.9,
    provenance: {
      'implementation-version': 1,
      provider: { id: 'sandbox', sandbox: true },
      thresholds: { 'max-age-difference-years': 10 },
    },
  },
  {
    name: 'id_expired_detection',
    status: 'failed',
    reasons: ['expired'],
    requirement: 'required',
    metadata: {},
    stage: 'ga',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: { 'grace-days': 0 } },
  },
];

function renderResults(props: Partial<CheckResultsProps> = {}) {
  return render(<CheckResults checks={CHECKS} label="Government ID" status="failed" {...props} />);
}

const attention = () =>
  screen.getByRole('table', { name: 'Government ID checks needing attention' });
const others = () =>
  screen.getByRole('table', { name: 'Other Government ID checks', hidden: true });

function rowFor(name: string): HTMLElement {
  const row = screen.getByRole('rowheader', { name, hidden: true }).closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
}

const rowNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('rowheader', { hidden: true })
    .map((header) => header.textContent);

async function openOthers() {
  await userEvent.click(screen.getByText(/^Other checks/));
}

describe('CheckResults: what needs the operator first (C37)', () => {
  it('lists the required failures, then the checks without evidence, then the advisory failures', () => {
    renderResults();

    expect(rowNames(attention())).toEqual([
      'id_expired_detection',
      'id_public_figure_detection',
      'id_repeat_detection',
    ]);
  });

  it('folds the rest into a closed disclosure that counts them, and opens it on demand', async () => {
    renderResults();

    const summary = screen.getByText('Other checks: 4 passed, 1 not applicable');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(rowFor('id_glare_detection')).not.toBeVisible();

    await openOthers();

    expect(others()).toBeVisible();
    expect(rowNames(others())).toEqual([
      'id_glare_detection',
      'id_tamper_detection',
      'id_barcode_detection',
      'id_portrait_detection',
      'id_age_inconsistency_detection',
    ]);
  });

  it('says nothing needs the operator when every check passed or does not apply, and counts them all', () => {
    renderResults({
      checks: CHECKS.filter((check) => check.status === 'passed'),
      status: 'passed',
    });

    expect(screen.getByText('No check failed or is waiting for review.')).toBeVisible();
    expect(screen.queryByRole('table', { name: /needing attention/ })).not.toBeInTheDocument();
    expect(screen.getByText('All checks: 4 passed').tagName).toBe('SUMMARY');
    expect(
      screen.getByRole('table', { name: 'Government ID checks', hidden: true }),
    ).toBeInTheDocument();
  });

  it('names the required checks that sent a verification to review, with their reasons', () => {
    renderResults({
      checks: CHECKS.filter((check) => check.status !== 'failed'),
      status: 'needs_review',
    });

    const note = screen.getByRole('note', { name: 'Why it needs review' });
    expect(note).toHaveTextContent('Sent to review by 1 required check without evidence:');
    const item = within(within(note).getByRole('list')).getByRole('listitem');
    expect(item).toHaveTextContent('id_public_figure_detection (Not configured)');
  });

  it('says a verification in review that lists no check without evidence waits on a missing result', () => {
    renderResults({
      checks: CHECKS.filter((check) => check.name === 'id_glare_detection'),
      status: 'needs_review',
    });

    expect(screen.getByRole('note', { name: 'Why it needs review' })).toHaveTextContent(
      'A required check has no result.',
    );
  });

  it('adds no review note to a verification that is not in review', () => {
    renderResults();

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('CheckResults: honesty labels (C29.2, ADR 0002 §3c)', () => {
  it('badges every beta result "Beta", in text, and no ga result', async () => {
    renderResults();
    await openOthers();

    for (const name of [
      'id_tamper_detection',
      'id_portrait_detection',
      'id_age_inconsistency_detection',
      'id_public_figure_detection',
    ]) {
      expect(within(rowFor(name)).getByText('Beta'), name).toHaveAttribute('data-stage', 'beta');
    }
    for (const name of ['id_glare_detection', 'id_expired_detection', 'id_repeat_detection']) {
      expect(within(rowFor(name)).queryByText('Beta'), name).not.toBeInTheDocument();
    }
  });

  it('shows a confidence, labelled, only where the result has one', async () => {
    renderResults();
    await openOthers();

    expect(within(rowFor('id_tamper_detection')).getByText('Confidence')).toBeVisible();
    expect(within(rowFor('id_tamper_detection')).getByText('0.58')).toBeVisible();
    expect(within(rowFor('id_age_inconsistency_detection')).getByText('0.90')).toBeVisible();
    for (const name of ['id_glare_detection', 'id_portrait_detection', 'id_expired_detection']) {
      expect(within(rowFor(name)).queryByText('Confidence'), name).not.toBeInTheDocument();
    }
  });

  it('shows no badge and no confidence for a stored result that has neither (Phase 1 and 2 rows)', () => {
    renderResults({
      checks: [
        {
          name: 'id_blur_detection',
          status: 'failed',
          reasons: ['image_blurry'],
          requirement: 'required',
          metadata: {},
        },
      ],
    });

    const row = rowFor('id_blur_detection');
    expect(within(row).queryByText('Beta')).not.toBeInTheDocument();
    expect(within(row).queryByText('Confidence')).not.toBeInTheDocument();
    // No provenance either: the provenance cell says so.
    expect(within(row).getByText('Not recorded')).toBeVisible();
  });
});

describe('CheckResults: reasons in words (C37)', () => {
  it('says each reason in words, beside its code', async () => {
    renderResults();
    await openOthers();

    const expired = rowFor('id_expired_detection');
    expect(within(expired).getByText('Expired')).toBeVisible();
    expect(within(expired).getByText('expired', { selector: 'code' })).toBeVisible();
    expect(
      within(rowFor('id_barcode_detection')).getByText('Not on this kind of document'),
    ).toBeVisible();
  });

  it('says an unconfigured provider is "Not configured", and that no provider is bound here (ADR 0002 §3e)', () => {
    renderResults();

    const row = rowFor('id_public_figure_detection');
    expect(within(row).getByText('Not applicable')).toBeVisible();
    expect(within(row).getByText('Not configured')).toBeVisible();
    expect(
      within(row).getByText('No provider is bound to this check in this environment.'),
    ).toBeVisible();
  });

  it('shows a reason it has no words for as its code, in monospace', () => {
    renderResults({
      checks: [
        {
          name: 'id_tamper_detection',
          status: 'failed',
          reasons: ['a_reason_from_the_future', 'constructor'],
          requirement: 'required',
          metadata: {},
          stage: 'beta',
          confidence: 0.7,
          provenance: { 'implementation-version': 1, thresholds: {} },
        },
      ],
    });

    const row = rowFor('id_tamper_detection');
    expect(within(row).getByText('a_reason_from_the_future')).toHaveClass('font-mono');
    expect(within(row).getByText('constructor')).toHaveClass('font-mono');
  });

  it('says "None" for a check without reasons', async () => {
    renderResults();
    await openOthers();

    expect(within(rowFor('id_glare_detection')).getByText('None')).toBeVisible();
  });
});

describe('CheckResults: provenance (C29.2, ADR 0002 §3f)', () => {
  it('keeps each check provenance in its own closed disclosure, named after the check', async () => {
    renderResults();
    await openOthers();

    const summary = within(rowFor('id_portrait_detection')).getByText(/^Show/);
    expect(summary.tagName).toBe('SUMMARY');
    // Browsers name a summary from its content (the testing library does not compute it).
    expect(summary).toHaveTextContent(/^Show the provenance of id_portrait_detection$/);
    expect(
      within(rowFor('id_portrait_detection')).getByText('Implementation version'),
    ).not.toBeVisible();
  });

  it('shows the implementation version, the models by id and short digest, and the thresholds', async () => {
    renderResults();
    await openOthers();
    const row = rowFor('id_portrait_detection');

    await userEvent.click(within(row).getByText(/^Show/));

    const provenance = within(row).getByText('Implementation version').closest('dl');
    if (provenance === null) throw new Error('No provenance list');
    const value = (term: string) => within(provenance).getByText(term).nextElementSibling;
    expect(value('Implementation version')).toHaveTextContent('2');
    expect(value('Models')).toHaveTextContent('yunet-2026may');
    expect(value('Models')).toHaveTextContent(`SHA-256 ${SHA256.slice(0, 12)}`);
    expect(value('Models')).not.toHaveTextContent(SHA256.slice(0, 13));
    expect(value('Provider')).toHaveTextContent('No provider');
    expect(value('Thresholds')).toHaveTextContent('required-fields: name-first, birthdate');
    expect(value('Thresholds')).toHaveTextContent('strict-mode: true');
  });

  it('says a list of match groups (C51.3) as alternatives, each group a set of field levels', async () => {
    render(
      <CheckResults
        checks={[
          {
            name: 'database_identity_comparison',
            status: 'passed',
            reasons: [],
            requirement: 'required',
            metadata: {},
            stage: 'beta',
            confidence: 0.8,
            provenance: {
              'implementation-version': 1,
              thresholds: {
                'match-groups': [
                  { name: 'partial', birthdate: 'partial' },
                  { name: 'partial', address: 'full' },
                ],
              },
            },
          },
        ]}
        label="Database"
        status="passed"
      />,
    );
    await userEvent.click(screen.getByText(/^All checks/));
    const row = rowFor('database_identity_comparison');

    await userEvent.click(within(row).getByText(/^Show/));

    const provenance = within(row).getByText('Implementation version').closest('dl');
    if (provenance === null) throw new Error('No provenance list');
    expect(within(provenance).getByText('Thresholds').nextElementSibling).toHaveTextContent(
      'match-groups: name partial and birthdate partial; or name partial and address full',
    );
  });

  it('names the provider, and says when it is a sandbox provider', async () => {
    renderResults();
    await openOthers();
    const row = rowFor('id_age_inconsistency_detection');

    await userEvent.click(within(row).getByText(/^Show/));

    const provider = within(row).getByText('Provider').nextElementSibling;
    expect(provider).toHaveTextContent('sandbox (sandbox)');
    expect(within(row).getByText('Models').nextElementSibling).toHaveTextContent('No model');
    expect(within(row).getByText('Thresholds').nextElementSibling).toHaveTextContent(
      'max-age-difference-years: 10',
    );
  });

  it("says how each threshold of a selfie result was set: a default's basis, or the template (C39.3)", async () => {
    renderResults({
      label: 'Selfie',
      checks: [
        {
          name: 'selfie_liveness_detection',
          status: 'passed',
          reasons: [],
          requirement: 'required',
          metadata: {},
          stage: 'beta',
          confidence: 0.4,
          provenance: {
            'implementation-version': 1,
            thresholds: { 'min-passive-score': 0.55, 'min-side-identity-cosine': 0.45 },
            'threshold-basis': { 'min-passive-score': 'provisional' },
          },
        },
        {
          name: 'selfie_id_comparison',
          status: 'passed',
          reasons: [],
          requirement: 'required',
          metadata: {},
          stage: 'beta',
          confidence: 0.9,
          provenance: {
            'implementation-version': 2,
            thresholds: { threshold: 0.371 },
            'threshold-basis': { threshold: 'calibrated' },
          },
        },
      ],
    });
    await userEvent.click(screen.getByText(/^All checks/));

    const thresholdsOf = async (name: string) => {
      const row = rowFor(name);
      await userEvent.click(within(row).getByText(/^Show/));
      return within(row).getByText('Thresholds').nextElementSibling;
    };
    const liveness = await thresholdsOf('selfie_liveness_detection');
    expect(liveness).toHaveTextContent('min-passive-score: 0.55 (Provisional)');
    expect(liveness).toHaveTextContent('min-side-identity-cosine: 0.45 (Set by the template)');
    expect(await thresholdsOf('selfie_id_comparison')).toHaveTextContent(
      'threshold: 0.371 (Calibrated)',
    );
  });

  it('claims no basis for a result that records none', async () => {
    renderResults();
    await openOthers();
    const row = rowFor('id_age_inconsistency_detection');

    await userEvent.click(within(row).getByText(/^Show/));

    expect(within(row).getByText('Thresholds').nextElementSibling).toHaveTextContent(
      /^max-age-difference-years: 10$/,
    );
  });

  it('renders provenance values as text, never as markup', async () => {
    const { container } = renderResults({
      checks: [
        {
          name: 'id_tamper_detection',
          status: 'failed',
          reasons: ['editing_software_detected'],
          requirement: 'required',
          metadata: {},
          stage: 'beta',
          confidence: 0.7,
          provenance: {
            'implementation-version': 1,
            models: [{ id: '<img src=x onerror=alert(1)>', sha256: SHA256 }],
            provider: { id: 'sandbox', sandbox: false },
            thresholds: { 'max-tamper-score': '<b>0.5</b>' },
          },
        },
      ],
    });

    await userEvent.click(within(rowFor('id_tamper_detection')).getByText(/^Show/));

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(screen.getByText('Provider').nextElementSibling).toHaveTextContent(/^sandbox$/);
  });
});

describe('CheckResults: the verification page', () => {
  it('shows each check metadata as terms and values', async () => {
    renderResults({ detailed: true });
    await openOthers();

    expect(
      within(rowFor('id_glare_detection')).getByText('glare_ratio').nextElementSibling,
    ).toHaveTextContent('0.004');
  });

  it('leaves the metadata out of the verification card', async () => {
    renderResults();
    await openOthers();

    expect(within(rowFor('id_glare_detection')).queryByText('glare_ratio')).not.toBeInTheDocument();
  });
});

describe('CheckResults: where an inquiry comparison read each value (C149.4; K9-16)', () => {
  const comparison = (metadata: VerificationCheck['metadata']): VerificationCheck => ({
    name: 'id_inquiry_comparison',
    status: 'passed',
    reasons: [],
    requirement: 'not_required',
    metadata,
    stage: 'ga',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: {} },
  });

  it('says in words beside each compared field whether it read the initial or an entered value', async () => {
    renderResults({
      detailed: true,
      checks: [
        ...CHECKS,
        comparison({
          'compared-fields': ['name', 'birthdate', 'address'],
          'mismatched-fields': [],
          'comparison-source': { name: 'initial', birthdate: 'entered', address: 'initial' },
        }),
      ],
    });
    await openOthers();

    const sources = within(rowFor('id_inquiry_comparison')).getByRole('list', {
      name: 'Where each compared value came from',
    });
    expect(
      within(sources)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Name: compared with the value set when the inquiry was created, which the person could not change',
      'Birth date: compared with a value entered after the inquiry was created, by the person or through the API',
      'Address: compared with the value set when the inquiry was created, which the person could not change',
    ]);
  });

  it('says not recorded for a compared field the result names no source for, never a source', async () => {
    renderResults({
      detailed: true,
      checks: [
        ...CHECKS,
        comparison({
          'compared-fields': ['name', 'identification-number'],
          'mismatched-fields': [],
        }),
      ],
    });
    await openOthers();

    const sources = within(rowFor('id_inquiry_comparison')).getByRole('list', {
      name: 'Where each compared value came from',
    });
    expect(
      within(sources)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Name: where the compared value came from is not recorded',
      'Identification number: where the compared value came from is not recorded',
    ]);
  });
});

describe('CheckResults: the category of every check (C50.8, C66)', () => {
  /** One check of each category, as a Phase 5 server derives it from the registry. */
  const CATEGORIZED: VerificationCheck[] = [
    {
      name: 'selfie_id_comparison',
      status: 'failed',
      reasons: ['face_mismatch'],
      requirement: 'required',
      metadata: {},
      category: 'biometrics',
    },
    {
      name: 'crypto_wallet_address_comparison',
      status: 'failed',
      reasons: ['signature_address_mismatch'],
      requirement: 'required',
      metadata: {},
      category: 'fraud',
    },
    {
      name: 'phone_number_otp_comparison',
      status: 'failed',
      reasons: ['otp_not_confirmed'],
      requirement: 'required',
      metadata: {},
      category: 'user_action_required',
    },
    {
      name: 'document_recency_detection',
      status: 'failed',
      reasons: ['document_too_old'],
      requirement: 'required',
      metadata: {},
      category: 'validity',
    },
  ];

  it('says each check category in words, in a column of its own beside the requirement', () => {
    renderResults({ checks: CATEGORIZED });

    expect(
      within(attention())
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Check', 'Status', 'Requirement', 'Category', 'Reasons', 'Provenance']);
    expect(within(rowFor('selfie_id_comparison')).getByText('Biometrics')).toBeVisible();
    expect(within(rowFor('crypto_wallet_address_comparison')).getByText('Fraud')).toBeVisible();
    expect(
      within(rowFor('phone_number_otp_comparison')).getByText('User action required'),
    ).toBeVisible();
    expect(within(rowFor('document_recency_detection')).getByText('Validity')).toBeVisible();
  });

  it('says "Not reported" for a result an earlier server served without one', async () => {
    renderResults({ detailed: true });
    await openOthers();

    for (const name of ['id_expired_detection', 'id_glare_detection']) {
      expect(within(rowFor(name)).getByText('Not reported')).toBeInTheDocument();
    }
  });
});

describe('CheckResults: advisory checks (C30.1, C51.1, ADR 0002)', () => {
  it('says a check the template does not require is advisory', async () => {
    renderResults();
    await openOthers();

    expect(within(rowFor('id_tamper_detection')).getByText('Advisory')).toBeVisible();
    expect(within(rowFor('id_glare_detection')).getByText('Required')).toBeVisible();
  });

  it('says an advisory failure does not decide the verification', () => {
    renderResults();

    const repeat = rowFor('id_repeat_detection');
    expect(within(repeat).getByText('Advisory')).toBeVisible();
    expect(within(repeat).getByText('Does not decide the verification')).toBeVisible();
  });

  it('says so of no required failure and no advisory check that did not fail', async () => {
    renderResults();
    await openOthers();

    for (const name of ['id_expired_detection', 'id_tamper_detection', 'id_glare_detection']) {
      expect(rowFor(name)).not.toHaveTextContent('Does not decide');
    }
  });
});
