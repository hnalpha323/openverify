import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_TAB_KEYS, TemplateTabs, templateTabHref } from './template-tabs';

const TEMPLATE = 'itmpl_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';

describe('the template page’s sections (Workflow 9C)', () => {
  it.each([
    ['overview', `/templates/${TEMPLATE}`],
    ['flow', `/templates/${TEMPLATE}/flow`],
    ['settings', `/templates/${TEMPLATE}/settings`],
    ['translations', `/templates/${TEMPLATE}/translations`],
    ['theme', `/templates/${TEMPLATE}/theme`],
    ['preview', `/templates/${TEMPLATE}/preview`],
  ] as const)('puts %s at %s', (key, href) => {
    expect(templateTabHref(TEMPLATE, key)).toBe(href);
  });

  it('links every section in a labelled navigation, the current one marked as the page', () => {
    render(<TemplateTabs templateId={TEMPLATE} current="theme" />);

    const nav = screen.getByRole('navigation', { name: 'Template sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Overview',
      'Flow',
      'Settings',
      'Translations',
      'Theme',
      'Preview',
    ]);
    expect(links).toHaveLength(TEMPLATE_TAB_KEYS.length);
    expect(within(nav).getByRole('link', { name: 'Theme' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('encodes the template id it is given', () => {
    expect(templateTabHref('itmpl_a/b', 'flow')).toBe('/templates/itmpl_a%2Fb/flow');
  });
});
