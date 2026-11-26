import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranslationsEditor } from '../translations/translations-editor';
import { CounselReviewNote } from './counsel-review-note';

describe('the built-in consent texts not reviewed by counsel (C238.10)', () => {
  it('says so for a share.consent key, and nothing for another key', () => {
    const { unmount } = render(<CounselReviewNote copyKey="share.consent.source" />);
    expect(screen.getByText('Not reviewed by counsel')).toBeInTheDocument();
    unmount();

    const { container } = render(<CounselReviewNote copyKey="consent.title" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows in the template editor’s text rules beside the legal weight (the named borrowed edit)', () => {
    render(
      <TranslationsEditor
        templateId="itmpl_01M5CN0000000000000011A600"
        keys={[
          {
            key: 'share.consent.source',
            kind: 'built-in',
            step: null,
            stepName: null,
            component: null,
            attribute: 'share.consent.source',
            maxLength: 2000,
            placeholders: ['source', 'recipient', 'categories', 'expires', 'withdraw'],
            multiline: true,
            consent: false,
            legal: 'consent',
            biometric: false,
          },
        ]}
        values={{ 'share.consent.source': { en: 'Synthetic operator text' } }}
        enabledLocales={['en']}
      />,
    );

    expect(screen.getByText('Not reviewed by counsel')).toBeInTheDocument();
  });
});
