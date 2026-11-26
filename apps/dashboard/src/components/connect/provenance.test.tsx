import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CLONE_PROVENANCE, HYDRATE_PROVENANCE, SHARE_TOKEN_ID } from './connect-fixtures';
import { ClonedMarker, ProvenanceBanner, ReliedOnClonedNote } from './provenance';

const TOKEN_HREF = `/settings/connect/share-tokens/${SHARE_TOKEN_ID}`;

describe('the Cloned marker and the provenance banner (C242.4, C235)', () => {
  it('marks a cloned result as Cloned, and says when the consent it rests on was withdrawn', () => {
    const { unmount } = render(<ClonedMarker />);
    expect(screen.getByText('Cloned')).toBeInTheDocument();
    unmount();

    render(<ClonedMarker withdrawnAt="2026-10-22T08:00:00.000Z" />);
    expect(screen.getByText('Cloned')).toBeInTheDocument();
    expect(screen.getByText('Consent withdrawn Oct 22, 2026, 8:00 AM UTC')).toBeInTheDocument();
  });

  it('names the token and the source organization on a cloned object, and says none of it is a check this organization ran', () => {
    render(<ProvenanceBanner provenance={CLONE_PROVENANCE} objectWord="inquiry" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Cloned from Example Source');
    expect(banner).toHaveTextContent('none is a check this organization ran');
    expect(banner).toHaveTextContent('sandbox');
    expect(banner).toHaveTextContent('approved');
    expect(screen.getByRole('link', { name: SHARE_TOKEN_ID })).toHaveAttribute('href', TOKEN_HREF);
  });

  it('says that copies resting on a withdrawn consent no longer count (C237.6)', () => {
    render(
      <ProvenanceBanner
        provenance={{ ...CLONE_PROVENANCE, 'consent-withdrawn-at': '2026-10-22T08:00:00.000Z' }}
        objectWord="inquiry"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'The consent to receive this share was withdrawn on Oct 22, 2026, 8:00 AM UTC',
    );
  });

  it('lists the hydrated fields with their token', () => {
    render(<ProvenanceBanner provenance={HYDRATE_PROVENANCE} objectWord="account" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Fields filled from Example Source');
    expect(banner).toHaveTextContent('birthdate and name_first');
    expect(screen.getByRole('link', { name: SHARE_TOKEN_ID })).toHaveAttribute('href', TOKEN_HREF);
  });

  it('says a decision relied on a cloned result, with its token when known', () => {
    const { unmount } = render(<ReliedOnClonedNote shareTokenId={SHARE_TOKEN_ID} />);
    expect(screen.getByText(/Relied on a cloned result/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: SHARE_TOKEN_ID })).toHaveAttribute('href', TOKEN_HREF);
    unmount();

    render(<ReliedOnClonedNote shareTokenId={null} />);
    expect(screen.getByText(/Relied on a cloned result/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
