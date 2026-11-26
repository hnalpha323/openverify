/**
 * C161.7, C171.3 (1.4.10, 1.4.12): what a pseudo-locale pass looks for on a rendered step, at 320
 * CSS px. `findPseudoLocaleProblems` runs in the page through `page.evaluate`, so it is
 * self-contained: it reads only its argument and the page's globals.
 *
 * - **Sideways scrolling:** the page is wider than the viewport.
 * - **Clipped text:** an element whose box hides overflow (`overflow` or `overflow-x`/`-y` hidden or
 *   clip, or `text-overflow: ellipsis`) is narrower or shorter than its content.
 * - **Unbracketed text:** every catalog message is bracketed in a pseudo-locale, so a block of
 *   visible text with letters outside every `[…]` is text that is not in a catalog (or a sentence
 *   built by concatenation around one). Hidden text (`hidden`, `aria-hidden`, `display: none`,
 *   `visibility: hidden`), scripts and styles are skipped; digits and punctuation are not words.
 */

export interface PseudoLocaleProblems {
  /** The page scrolls sideways. */
  readonly horizontalScroll: boolean;
  /** Text cut by its box: `<tag>: <text>` for each element. */
  readonly clipped: readonly string[];
  /** Visible text outside a bracketed message, as shown. */
  readonly unbracketed: readonly string[];
}

export interface PseudoLocaleCheckOptions {
  /** Texts that are not catalog messages (a name, a value the test entered). */
  readonly allowedTexts?: readonly string[];
  /** Elements whose text is not checked for brackets (the language selector, a QR code). */
  readonly ignoreSelectors?: readonly string[];
}

export function findPseudoLocaleProblems(
  options: PseudoLocaleCheckOptions = {},
): PseudoLocaleProblems {
  const allowedTexts = options.allowedTexts ?? [];
  const ignored = ['script', 'style', 'noscript', 'template', ...(options.ignoreSelectors ?? [])];

  const isHidden = (element: Element): boolean => {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') {
        return true;
      }
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
      }
    }
    return false;
  };

  const isIgnored = (element: Element): boolean =>
    ignored.some((selector) => element.closest(selector) !== null);

  const INLINE = new Set(['inline', 'contents']);
  const blockOf = (element: Element): Element => {
    let block = element;
    while (
      block.parentElement !== null &&
      block !== document.body &&
      INLINE.has(window.getComputedStyle(block).display)
    ) {
      block = block.parentElement;
    }
    return block;
  };

  const outsideBrackets = (text: string): string => {
    let depth = 0;
    let outside = '';
    for (const character of text) {
      if (character === '[') {
        depth += 1;
        outside += ' ';
      } else if (character === ']' && depth > 0) {
        depth -= 1;
        outside += ' ';
      } else {
        outside += depth === 0 ? character : ' ';
      }
    }
    return outside;
  };

  // Unbracketed text, block by block, each block once.
  const blocks: Element[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || (node.textContent ?? '').trim() === '') {
      continue;
    }
    if (isHidden(parent) || isIgnored(parent)) {
      continue;
    }
    const block = blockOf(parent);
    if (!blocks.includes(block)) {
      blocks.push(block);
    }
  }
  const unbracketed: string[] = [];
  for (const block of blocks) {
    let text = '';
    const blockWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = blockWalker.nextNode(); node !== null; node = blockWalker.nextNode()) {
      const parent = node.parentElement;
      if (parent !== null && !isHidden(parent) && !isIgnored(parent)) {
        text += node.textContent ?? '';
      }
    }
    let outside = outsideBrackets(text);
    for (const allowed of allowedTexts) {
      outside = outside.split(allowed).join(' ');
    }
    const words = outside.replace(/\s+/g, ' ').trim();
    if (/\p{L}/u.test(words)) {
      unbracketed.push(words);
    }
  }

  // Text its box cuts.
  const CUTTING = new Set(['hidden', 'clip']);
  const clipped: string[] = [];
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (isHidden(element) || element.textContent.trim() === '') {
      continue;
    }
    const style = window.getComputedStyle(element);
    const cutsAcross =
      CUTTING.has(style.overflowX) ||
      CUTTING.has(style.overflow) ||
      style.textOverflow === 'ellipsis';
    const cutsDown = CUTTING.has(style.overflowY) || CUTTING.has(style.overflow);
    const across = cutsAcross && element.scrollWidth > element.clientWidth + 1;
    const down = cutsDown && element.scrollHeight > element.clientHeight + 1;
    if (across || down) {
      const text = element.textContent.replace(/\s+/g, ' ').trim();
      clipped.push(`${element.tagName.toLowerCase()}: ${text}`);
    }
  }

  const root = document.scrollingElement ?? document.documentElement;
  return {
    horizontalScroll: root.scrollWidth > root.clientWidth + 1,
    clipped,
    unbracketed,
  };
}
