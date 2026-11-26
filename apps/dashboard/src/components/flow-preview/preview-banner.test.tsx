import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import { PreviewBanner } from './preview-banner';

/**
 * C221.9 (Phase 10, Workflow 10A integration-10a; review H21): the preview shows the web flow, and
 * the Android SDK draws the same steps with the system font and Material's components, so the
 * banner says the app's screens differ from the preview in type and shape.
 */
describe('PreviewBanner', () => {
  it('says the Android app draws the screens with the system font and Material components', () => {
    render(<PreviewBanner />);

    const banner = screen.getByRole('region', { name: PREVIEW_COPY.banner.heading });
    const items = within(banner).getAllByRole('listitem');
    const android = items.find((item) => item.textContent.includes('Android'));
    expect(android?.textContent).toMatch(/system font/);
    expect(android?.textContent).toMatch(/Material/);
    expect(android?.textContent).toMatch(/type and shape/);
  });
});
