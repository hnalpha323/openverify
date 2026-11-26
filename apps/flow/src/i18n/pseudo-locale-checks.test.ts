/**
 * C161.7, C171.3 (1.4.10, 1.4.12): the mocked suite's pseudo-locale helpers
 * (`e2e/support/pseudo-locale*.ts`), whose page checks run in the browser through
 * `page.evaluate`. Here they run on jsdom, whose layout sizes are set by hand.
 */
import { pseudoLocalize } from '@openverify/flow-spec';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PSEUDO_BASE_LANGUAGE,
  pseudoCopy,
  pseudoMessages,
} from '../../e2e/support/pseudo-locale-catalog';
import { findPseudoLocaleProblems } from '../../e2e/support/pseudo-locale-checks';
import { CATALOGS } from './catalogs';

afterEach(() => {
  document.body.innerHTML = '';
});

function size(
  element: Element,
  sizes: Partial<Record<'scrollWidth' | 'clientWidth' | 'scrollHeight' | 'clientHeight', number>>,
) {
  for (const [name, value] of Object.entries(sizes)) {
    Object.defineProperty(element, name, { configurable: true, value });
  }
}

describe('the pseudo-locale catalogs of the mocked suite', () => {
  it('transform every English message, keeping the catalog’s shape', () => {
    const messages = pseudoMessages('en-XA');

    expect(messages.consent.continue).toBe(pseudoLocalize('en-XA', CATALOGS.en.consent.continue));
    expect(pseudoMessages('ar-XB').attempt).toBe('[{{max}} fo {{current}} tpmettA]');
    expect(Object.keys(messages)).toEqual(Object.keys(CATALOGS.en));
  });

  it('serve as a session’s copy under the base language that sets the direction', () => {
    expect(PSEUDO_BASE_LANGUAGE).toEqual({ 'en-XA': 'en', 'ar-XB': 'ar' });
    const copy = pseudoCopy('ar-XB');

    expect(Object.keys(copy.messages)).toEqual(['ar']);
    expect(copy.messages.ar?.['consent.continue']).toBe(
      pseudoLocalize('ar-XB', CATALOGS.en.consent.continue),
    );
    expect(Object.keys(copy.messages.ar ?? {}).length).toBeGreaterThan(400);
  });
});

describe('findPseudoLocaleProblems', () => {
  it('passes a page whose every visible text is a bracketed message', () => {
    document.body.innerHTML =
      '<main><h1>[Ţîţļé one]</h1><p>[Šéñţ ţö <bdi>a@b.c</bdi> one two]</p>' +
      '<button>[Ƈöñţîñûé one]</button></main>';

    expect(findPseudoLocaleProblems()).toEqual({
      horizontalScroll: false,
      clipped: [],
      unbracketed: [],
    });
  });

  it('reports text outside every bracket, as written', () => {
    document.body.innerHTML =
      '<main><h1>[Ţîţļé one]</h1><p>Hard-coded words</p><p>[Ǿñé] stray [Ţŵö]</p></main>';

    expect(findPseudoLocaleProblems().unbracketed).toEqual(['Hard-coded words', 'stray']);
  });

  it('ignores hidden text, digits and punctuation, and the texts and elements it is told to', () => {
    document.body.innerHTML =
      '<main><p hidden>Hidden</p><p aria-hidden="true">Decorative</p>' +
      '<p style="display: none">None</p><p>3 / 5 — 10:30</p>' +
      '<select><option lang="en">English</option></select><p>OpenVerify</p></main>';

    expect(
      findPseudoLocaleProblems({ allowedTexts: ['OpenVerify'], ignoreSelectors: ['select'] }),
    ).toEqual({ horizontalScroll: false, clipped: [], unbracketed: [] });
  });

  it('reports a page that scrolls sideways', () => {
    document.body.innerHTML = '<main><p>[x]</p></main>';
    const root = document.scrollingElement ?? document.documentElement;
    size(root, { scrollWidth: 400, clientWidth: 320 });

    expect(findPseudoLocaleProblems().horizontalScroll).toBe(true);
  });

  it('reports text its box cuts, by tag and text', () => {
    document.body.innerHTML =
      '<main><p id="cut" style="overflow: hidden">[Ļöñĝ ţéẋţ one two three]</p>' +
      '<p id="fits" style="overflow: hidden">[Šĥöŕţ]</p>' +
      '<p id="ellipsis" style="text-overflow: ellipsis; overflow-x: hidden">[Ŵîđé]</p></main>';
    size(document.getElementById('cut') as Element, { scrollWidth: 500, clientWidth: 300 });
    size(document.getElementById('fits') as Element, { scrollWidth: 300, clientWidth: 300 });
    size(document.getElementById('ellipsis') as Element, { scrollWidth: 301, clientWidth: 280 });

    expect(findPseudoLocaleProblems().clipped).toEqual([
      'p: [Ļöñĝ ţéẋţ one two three]',
      'p: [Ŵîđé]',
    ]);
  });

  it('reports text cut at the bottom of a box', () => {
    document.body.innerHTML =
      '<main><div id="short" style="overflow-y: clip">[Ţàļļ one two]</div></main>';
    size(document.getElementById('short') as Element, { scrollHeight: 90, clientHeight: 40 });

    expect(findPseudoLocaleProblems().clipped).toEqual(['div: [Ţàļļ one two]']);
  });
});
