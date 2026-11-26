/**
 * C62, C66: the chip evidence on its card and page: what a pass means; DG1's fields ("Hidden"
 * without `pii:view`, "Redacted" after a redaction, C53.7); passive authentication with its
 * integrity apart from its revocation, the anchor's source (sandbox-only labelled), how the anchor
 * was chosen and the signer's validity; the data-group table; Active Authentication; the device
 * report as client-reported, never evidence; the MRZ and selfie comparisons, the chip portrait
 * beside the selfie, earlier sightings as a count, and the expiry. Every value comes from the
 * verification answer alone.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerificationPage from '../../app/verifications/[id]/page';
import type { ChipEvidenceProps } from '../../lib/government-id-nfc-evidence';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  CHIP_IDS,
  chipCheck,
  chipFiles,
  chipVerification,
  selfieCenterFiles,
} from '../../testing/fixtures/government-id-nfc';
import { piiValuesOf } from '../../testing/phase5-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  DOCUMENTS_REVIEWER,
  DOCUMENTS_VIEWER,
  serveDocumentsVerification,
} from '../../testing/routes/documents';
import { VerificationCard } from '../verification-card';
import { GovernmentIdNfcEvidence } from './government-id-nfc';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const LABEL = 'Government ID chip';
const PA = 'id_nfc_passive_authentication_detection';
const AA = 'id_nfc_chip_authentication_detection';

function show(props: Partial<ChipEvidenceProps> = {}) {
  return render(
    <GovernmentIdNfcEvidence
      verification={chipVerification()}
      label={LABEL}
      state="visible"
      {...props}
    />,
  );
}

const group = () => screen.getByRole('group', { name: `${LABEL} evidence` });

function term(scope: HTMLElement, name: string): HTMLElement {
  const dd = within(scope).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${name}`);
  return dd;
}

function row(table: HTMLElement, name: string | RegExp): HTMLElement {
  const found = within(table).getByRole('rowheader', { name }).closest('tr');
  if (found === null) throw new Error(`No row ${String(name)}`);
  return found;
}

const notEstablished = (reason: string) =>
  chipVerification({
    status: 'needs_review',
    checks: {
      [PA]: {
        status: 'not_applicable',
        reasons: [reason],
        metadata: {
          integrity: 'not_established',
          'integrity-reason': reason,
          revocation: 'undetermined',
          'revocation-gap': 'crl_unavailable',
          'data-groups': { dg1: 'identical', dg2: 'identical', dg15: 'missing_from_upload' },
          flags: ['sha1'],
        },
      },
    },
    attributes: {
      'passive-authentication': {
        outcome: 'not_applicable',
        integrity: 'not_established',
        'anchor-source': null,
        'hash-algorithm': 'sha256',
        revocation: 'undetermined',
      },
    },
  });

describe('GovernmentIdNfcEvidence (C62, C66)', () => {
  // Workflow 5C review P024 (WCAG 1.3.1): each part's title is a heading one below the section
  // holding the evidence.
  it('titles each part with a heading at the level the host gives, still one group', () => {
    const { container } = show({ partHeadingLevel: 3 });

    expect(
      within(container)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Chip data (DG1)',
      'Passive authentication',
      'Active Authentication',
      'Comparisons',
      'Reuse and expiry',
    ]);
    expect(within(container).getAllByRole('group')).toHaveLength(1);
  });

  it('is one group named after the verification, saying what a pass means and what it does not', () => {
    const { container } = show();

    expect(group()).toHaveTextContent(/What a pass means/);
    expect(group()).toHaveTextContent(/bound to the person in the live selfie/);
    expect(group()).toHaveTextContent(/only when Active Authentication passed/);
    expect(within(container).getAllByRole('group')).toHaveLength(1);
  });

  it('shows DG1’s fields as the API sent them, with the class and the issuing country', () => {
    show();

    expect(term(group(), 'Last name')).toHaveTextContent(/^EXAMPLE$/);
    expect(term(group(), 'Document number')).toHaveTextContent(/^UT1234567$/);
    expect(term(group(), 'Date of birth')).toHaveTextContent(/^1990-04-12$/);
    expect(term(group(), 'ID class')).toHaveTextContent(/^passport$/);
    expect(term(group(), 'Issuing country')).toHaveTextContent(/^UT$/);
  });

  it('shows the fields the API masked as "Hidden", and "Redacted" after a redaction', () => {
    const { unmount } = show({ verification: chipVerification({ masked: true }), state: 'hidden' });
    expect(within(group()).getAllByText('Hidden', { exact: true })).toHaveLength(7);
    for (const value of piiValuesOf('verification/government-id-nfc')) {
      expect(group()).not.toHaveTextContent(value);
    }
    unmount();

    show({ verification: chipVerification({ masked: true }), state: 'redacted' });
    expect(term(group(), 'Last name')).toHaveTextContent(/^Redacted$/);
  });

  it('says nothing was judged before the checks ran, and claims no state', () => {
    show({
      verification: chipVerification({
        status: 'submitted',
        attributes: { 'passive-authentication': null, 'active-authentication': null },
        checks: Object.fromEntries(
          chipVerification().attributes.checks.map((check) => [check.name, null]),
        ),
      }),
    });

    expect(term(group(), 'Passive authentication')).toHaveTextContent(/^Not run$/);
    expect(term(group(), 'Integrity')).toHaveTextContent(/^Not recorded$/);
    expect(term(group(), 'Revocation')).toHaveTextContent(/^Not recorded$/);
    expect(term(group(), 'Signer certificate')).toHaveTextContent(/^Not recorded$/);
    expect(term(group(), 'Active Authentication')).toHaveTextContent(/^Not recorded$/);
    expect(term(group(), 'Earlier sightings on other accounts')).toHaveTextContent('Not counted');
    expect(within(group()).getByRole('table', { name: `${LABEL} data groups` })).toHaveTextContent(
      'No data group was recorded.',
    );
  });

  it('labels a verification read from a sandbox test chip, with its scenario and what it does not prove (C208.4)', () => {
    show({ verification: chipVerification({ attributes: { 'sandbox-chip': 'match' } }) });

    const label = within(group()).getByRole('note', { name: 'Test chip (sandbox)' });
    expect(label).toHaveTextContent('Test chip (sandbox)');
    expect(label).toHaveTextContent('match');
    expect(label).toHaveTextContent(/no document was read/);
    expect(label).toHaveTextContent(/says nothing about a chip reader or a real document/);
  });

  it('shows no test-chip label for any other chip', () => {
    show();

    expect(within(group()).queryByRole('note', { name: 'Test chip (sandbox)' })).toBeNull();
    expect(group()).not.toHaveTextContent('Test chip (sandbox)');
  });

  it('shows integrity apart from revocation, and the anchor’s source labelled sandbox-only', () => {
    show();

    expect(term(group(), 'Passive authentication')).toHaveTextContent('Passed');
    expect(term(group(), 'Integrity')).toHaveTextContent('Established');
    expect(term(group(), 'Revocation')).toHaveTextContent('Not revoked');
    expect(term(group(), 'Revocation')).toHaveTextContent('Strict');
    const anchor = term(group(), 'Trust anchor source');
    expect(anchor).toHaveTextContent('openverify-sandbox');
    expect(anchor).toHaveTextContent('Sandbox-only');
    expect(anchor).toHaveTextContent(/never trusted in a production environment/);
    expect(term(group(), 'Anchor chosen')).toHaveTextContent(
      'By the signer’s authority key identifier',
    );
    expect(term(group(), 'Signer certificate')).toHaveTextContent('Valid at verification time');
    expect(term(group(), 'Hash algorithm')).toHaveTextContent(/^sha256$/);
    expect(term(group(), 'Signature algorithm')).toHaveTextContent(/^ecdsa-with-sha256$/);
  });

  it('lists the data groups with their states in words', () => {
    show();

    const table = within(group()).getByRole('table', { name: `${LABEL} data groups` });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Data group', 'State']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual([
      'DG1 (MRZ)',
      'DG2 (portrait)',
      'DG14 (chip authentication keys)',
      'DG15 (Active Authentication key)',
    ]);
    expect(row(table, 'DG2 (portrait)')).toHaveTextContent('Identical');
  });

  it('never shows a trust-store gap as a pass, and says it goes to review', () => {
    show({ verification: notEstablished('certificate_expired') });

    const outcome = term(group(), 'Passive authentication');
    expect(outcome).toHaveTextContent('Not applicable');
    expect(outcome).not.toHaveTextContent('Passed');
    expect(outcome).toHaveTextContent('Certificate outside its validity');
    expect(term(group(), 'Integrity')).toHaveTextContent('Not established');
    expect(term(group(), 'Integrity')).toHaveTextContent(/review, never to a failure/);
    expect(term(group(), 'Revocation')).toHaveTextContent('Not determined');
    expect(term(group(), 'Revocation')).toHaveTextContent('No current CRL is held');
    expect(term(group(), 'Signer certificate')).toHaveTextContent(
      'Outside its validity at verification time',
    );
    expect(term(group(), 'Trust anchor source')).toHaveTextContent('No anchor recorded');
    expect(term(group(), 'Flags')).toHaveTextContent('SHA-1 in use (accepted, flagged)');
    const table = within(group()).getByRole('table', { name: `${LABEL} data groups` });
    expect(row(table, 'DG15 (Active Authentication key)')).toHaveTextContent(
      'Missing from the upload',
    );
  });

  it('says the signer’s validity was not judged when integrity was not established for another reason', () => {
    show({ verification: notEstablished('trust_anchor_unavailable') });

    expect(term(group(), 'Signer certificate')).toHaveTextContent(
      'Not judged: integrity was not established',
    );
  });

  it('shows Active Authentication over the server’s nonce, its scheme and the template’s rule', () => {
    show();

    expect(term(group(), 'Chip authentication')).toHaveTextContent('Passed');
    const active = term(group(), 'Active Authentication');
    expect(active).toHaveTextContent('Verified');
    expect(active).toHaveTextContent(/the chip itself was present/);
    expect(term(group(), 'Scheme')).toHaveTextContent('Plain ECDSA');
    expect(term(group(), 'Required by the template')).toHaveTextContent(/^No$/);
  });

  it('never shows a chip without an Active Authentication key as a pass (decision 33)', () => {
    show({
      verification: chipVerification({
        checks: {
          [AA]: {
            status: 'not_applicable',
            reasons: ['chip_auth_not_server_verifiable'],
            metadata: { outcome: 'not_listed' },
          },
        },
      }),
    });

    const outcome = term(group(), 'Chip authentication');
    expect(outcome).toHaveTextContent('Not applicable');
    expect(outcome).not.toHaveTextContent('Passed');
    expect(outcome).toHaveTextContent('Chip presence not verifiable here');
    expect(term(group(), 'Active Authentication')).toHaveTextContent(/This is not a pass/);
  });

  it('shows the device report as client-reported, never as evidence', () => {
    const { unmount } = show({
      verification: chipVerification({
        checks: {
          [AA]: {
            metadata: {
              ...chipCheck(AA).metadata,
              'device-reported': ['pace', 'active_authentication'],
            },
          },
        },
      }),
    });
    const report = term(group(), 'Device report');
    expect(report).toHaveTextContent('PACE, Active Authentication');
    expect(report).toHaveTextContent(/As reported by the client/);
    expect(report).toHaveTextContent(/never evidence/);
    unmount();

    show();
    expect(term(group(), 'Device report')).toHaveTextContent('Nothing reported');
  });

  it('shows the MRZ comparison with the fields compared and those that differ', () => {
    show();

    const mrz = term(group(), 'MRZ comparison');
    expect(mrz).toHaveTextContent('Passed');
    expect(mrz).toHaveTextContent(
      'Compared: Document number, Date of birth, Expiry date, Name, Nationality',
    );
    expect(mrz).toHaveTextContent('Differs: none');
    expect(mrz).toHaveTextContent(/confusables/);
  });

  it('shows the selfie comparison as a beta result with its similarity and threshold', () => {
    show();

    const selfie = term(group(), 'Selfie comparison');
    expect(selfie).toHaveTextContent('Passed');
    expect(selfie).toHaveTextContent('Beta');
    expect(term(group(), 'Similarity')).toHaveTextContent(/^0\.7100$/);
    expect(term(group(), 'Threshold')).toHaveTextContent('0.3940');
    expect(term(group(), 'Threshold')).toHaveTextContent(/not calibrated for chip portraits/);
  });

  it('shows earlier sightings as a count, advisory and review-level by default', () => {
    const { unmount } = show();
    expect(term(group(), 'Earlier sightings on other accounts')).toHaveTextContent(/^0$/);
    unmount();

    show({
      verification: chipVerification({
        checks: {
          id_nfc_repeat_detection: {
            status: 'not_applicable',
            reasons: ['chip_seen_on_other_account'],
            metadata: { sightings: 1 },
          },
        },
      }),
    });
    const repeat = term(group(), 'Repeat check');
    expect(repeat).toHaveTextContent('Not applicable');
    expect(repeat).toHaveTextContent('Advisory: it does not decide the verification');
    expect(repeat).toHaveTextContent('Chip seen on another account');
    expect(term(group(), 'Earlier sightings on other accounts')).toHaveTextContent(/^1$/);
  });

  it('shows the expiry on DG1', () => {
    show();

    expect(term(group(), 'Expiry')).toHaveTextContent('Passed');
  });

  it('shows the chip portrait beside the selfie centre photo it was compared with', () => {
    show({ files: chipFiles(), inquiryFiles: selfieCenterFiles(), media: 'visible' });

    expect(within(group()).getByRole('img', { name: 'Chip portrait' })).toHaveAttribute(
      'src',
      `/files/${CHIP_IDS.portrait}/rendition`,
    );
    expect(
      within(group()).getByRole('img', {
        name: 'Selfie centre photo the portrait was compared with',
      }),
    ).toHaveAttribute('src', `/files/${CHIP_IDS.selfieCenter}/rendition`);
  });

  it('says when no portrait or selfie photo is held, and hides them without pii:view', () => {
    const { unmount } = show({ files: [], inquiryFiles: [], media: 'visible' });
    expect(term(group(), 'Chip portrait')).toHaveTextContent(/No chip portrait was stored/);
    expect(term(group(), 'Selfie photo')).toHaveTextContent(/No selfie photo in the inquiry/);
    unmount();

    show({ files: chipFiles(), inquiryFiles: selfieCenterFiles(), media: 'hidden' });
    expect(within(group()).queryByRole('img')).toBeNull();
    expect(term(group(), 'Chip portrait')).toHaveTextContent('Hidden');
    expect(term(group(), 'Selfie photo')).toHaveTextContent('Hidden');
  });

  it('never says no selfie was compared when it was given only the verification’s own files', () => {
    show({ files: chipFiles(), media: 'visible' });

    const selfie = term(group(), 'Selfie photo');
    expect(selfie).not.toHaveTextContent(/No selfie photo/);
    expect(selfie).toHaveTextContent('Shown with the selfie verification');
    expect(selfie).toHaveTextContent(CHIP_IDS.selfie);
    expect(within(group()).getAllByRole('img')).toHaveLength(1);
  });

  it('leaves the files to the files section when it is given none', () => {
    show();

    expect(within(group()).queryByRole('img')).toBeNull();
    expect(within(group()).queryByText('Chip portrait', { selector: 'dt' })).toBeNull();
  });
});

const PORTRAIT_ALT = 'Chip portrait';
const SELFIE_ALT = 'Selfie centre photo the portrait was compared with';

/** Both images of the portrait part, each through the authenticated file route. */
function expectSideBySide(evidence: HTMLElement) {
  expect(
    within(term(evidence, 'Chip portrait')).getByRole('img', { name: PORTRAIT_ALT }),
  ).toHaveAttribute('src', `/files/${CHIP_IDS.portrait}/rendition`);
  expect(
    within(term(evidence, 'Selfie photo')).getByRole('img', { name: SELFIE_ALT }),
  ).toHaveAttribute('src', `/files/${CHIP_IDS.selfieCenter}/rendition`);
}

describe('a chip verification on its card (C66)', () => {
  const card = (props: Partial<Parameters<typeof VerificationCard>[0]> = {}) =>
    render(
      <VerificationCard
        verification={chipVerification()}
        title={LABEL}
        files={chipFiles()}
        media="visible"
        showChecks
        {...props}
      />,
    );

  it('shows the chip portrait beside the selfie centre photo, from the inquiry’s files', () => {
    card({ referenceFiles: [...chipFiles(), ...selfieCenterFiles()] });

    expectSideBySide(group());
  });

  it('points to the selfie verification when it was not given the inquiry’s files', () => {
    card();

    const selfie = term(group(), 'Selfie photo');
    expect(selfie).toHaveTextContent('Shown with the selfie verification');
    expect(selfie).toHaveTextContent(CHIP_IDS.selfie);
    expect(
      within(group())
        .getAllByRole('img')
        .map((image) => image.getAttribute('alt')),
    ).toEqual([PORTRAIT_ALT]);
  });

  it('hides both images without pii:view, and says Redacted after a redaction', () => {
    const referenceFiles = [...chipFiles(), ...selfieCenterFiles()];
    const { unmount } = card({ referenceFiles, media: 'hidden' });
    expect(within(group()).queryByRole('img')).toBeNull();
    expect(term(group(), 'Chip portrait')).toHaveTextContent('Hidden');
    expect(term(group(), 'Selfie photo')).toHaveTextContent('Hidden');
    unmount();

    card({ referenceFiles, media: 'redacted' });
    expect(within(group()).queryByRole('img')).toBeNull();
    expect(term(group(), 'Chip portrait')).toHaveTextContent('Redacted');
    expect(term(group(), 'Selfie photo')).toHaveTextContent('Redacted');
  });
});

describe('a chip verification on its page (C66)', () => {
  let api: RouteApi;

  beforeEach(() => {
    fakeRequest.reset();
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api = routeApi();
  });

  afterEach(() => {
    api.restore();
    vi.restoreAllMocks();
  });

  const page = () => VerificationPage({ params: Promise.resolve({ id: CHIP_IDS.verification }) });
  const region = (name: string) => screen.getByRole('region', { name });

  it('shows the evidence in the Evidence region, the portrait with the files and no raw chip file as an image', async () => {
    api.me({ permissions: DOCUMENTS_REVIEWER });
    serveDocumentsVerification(api, chipVerification(), { included: chipFiles() });

    render(await page());

    const evidence = within(region('Evidence')).getByRole('group', { name: `${LABEL} evidence` });
    expect(term(evidence, 'Integrity')).toHaveTextContent('Established');
    const files = within(region('Files')).getByRole('list', { name: `${LABEL} files` });
    expect(
      within(files)
        .getAllByRole('img')
        .map((image) => image.getAttribute('alt')),
    ).toEqual([`${LABEL}, chip portrait`]);
  });

  const evidenceOnPage = () =>
    within(region('Evidence')).getByRole('group', { name: `${LABEL} evidence` });

  it('shows the selfie centre photo beside the chip portrait, from the inquiry document', async () => {
    api.me({ permissions: DOCUMENTS_REVIEWER });
    serveDocumentsVerification(api, chipVerification(), {
      included: [...chipFiles(), ...selfieCenterFiles()],
    });

    render(await page());

    expectSideBySide(evidenceOnPage());
  });

  it('points to the selfie verification when the inquiry cannot be read', async () => {
    api.me({ permissions: ['verifications:read', 'pii:view'] });
    api.on('GET', `/verifications/${CHIP_IDS.verification}`, 200, { data: chipVerification() });

    render(await page());

    const selfie = term(evidenceOnPage(), 'Selfie photo');
    expect(selfie).toHaveTextContent('Shown with the selfie verification');
    expect(selfie).toHaveTextContent(CHIP_IDS.selfie);
  });

  // Workflow 6B P5-3 (a Phase 5 console gap): without the inquiry the file kinds are unknown.
  it('points to the files for the chip portrait when the inquiry cannot be read, never "not stored"', async () => {
    api.me({ permissions: ['verifications:read', 'pii:view'] });
    api.on('GET', `/verifications/${CHIP_IDS.verification}`, 200, { data: chipVerification() });

    render(await page());

    const portrait = term(evidenceOnPage(), 'Chip portrait');
    expect(portrait).not.toHaveTextContent(/not stored/);
    expect(portrait).toHaveTextContent('Listed with the files');
    expect(portrait).toHaveTextContent('inquiries:read');
    expect(term(evidenceOnPage(), 'Selfie photo')).toHaveTextContent(
      'Shown with the selfie verification',
    );
  });

  it('hides the selfie photo without pii:view, and says Redacted after a redaction', async () => {
    api.me({ permissions: DOCUMENTS_VIEWER });
    serveDocumentsVerification(api, chipVerification({ masked: true }), {
      seen: chipVerification(),
      included: [...chipFiles(), ...selfieCenterFiles()],
    });
    const { unmount } = render(await page());
    expect(within(evidenceOnPage()).queryByRole('img')).toBeNull();
    expect(term(evidenceOnPage(), 'Selfie photo')).toHaveTextContent('Hidden');
    unmount();

    api.me({ permissions: DOCUMENTS_REVIEWER });
    serveDocumentsVerification(api, chipVerification(), {
      included: [...chipFiles(), ...selfieCenterFiles()],
      redacted: true,
    });
    render(await page());
    expect(within(evidenceOnPage()).queryByRole('img')).toBeNull();
    expect(term(evidenceOnPage(), 'Selfie photo')).toHaveTextContent('Redacted');
  });

  it('lets no masked value reach the page or the RSC payload, even from the inquiry document', async () => {
    api.me({ permissions: DOCUMENTS_VIEWER });
    serveDocumentsVerification(api, chipVerification({ masked: true }), {
      seen: chipVerification(),
      included: chipFiles(),
    });

    const element = await page();
    const payload = await rscPayloadOf(element);
    render(element);

    expect(term(region('Evidence'), 'Last name')).toHaveTextContent('Hidden');
    for (const value of piiValuesOf('verification/government-id-nfc')) {
      expect(document.body.textContent).not.toContain(value);
      expect(payload).not.toContain(value);
    }
  });
});
