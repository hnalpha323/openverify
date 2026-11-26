// @ts-check
/**
 * C161.3 (ours; the engineering note's 5.4): logical properties only in the flow and the shared
 * UI, so a right-to-left page (`<html dir="rtl">`) mirrors itself. The rule
 * `openverify-i18n/logical-properties` refuses Tailwind's physical utilities `ml-`, `mr-`, `pl-`,
 * `pr-`, `left-`, `right-`, `text-left` and `text-right` (with any variant, `!` or `-`) in every
 * string and template literal of those files, so a `className`, a class map and a `cx` argument are
 * all covered, and names the logical utility to use instead (`ms-`, `me-`, `ps-`, `pe-`, `start-`,
 * `end-`, `text-start`, `text-end`). A token counts only when it is the whole utility with a
 * Tailwind value (`ml-2`, `right-1/2`, `left-[3px]`, `pl-(--gutter)`), so prose such as
 * "right-to-left" is never read as a class. A utility under an explicit `rtl:` or `ltr:` variant is
 * direction-aware by construction and passes, for the rare physical case. Spread into the root
 * `eslint.config.js`; `foundation-9a` exports it from `@openverify/config`.
 */

/** The files the rule applies to. */
export const LOGICAL_PROPERTIES_FILES = Object.freeze([
  'apps/flow/src/**/*.{ts,tsx}',
  'packages/ui/src/**/*.{ts,tsx}',
]);

/** Each physical utility prefix and the logical one to use instead. */
const LOGICAL_FOR = Object.freeze({
  ml: 'ms',
  mr: 'me',
  pl: 'ps',
  pr: 'pe',
  left: 'start',
  right: 'end',
});

/** A Tailwind value: a number, `px`, `auto`, `full`, a fraction, `[arbitrary]` or `(--variable)`. */
const VALUE = String.raw`(?:\d+(?:\.\d+)?|px|auto|full|\d+\/\d+|\[[^\]\s]+\]|\([^)\s]+\))`;
const PHYSICAL_UTILITY = new RegExp(
  String.raw`^(?:(ml|mr|pl|pr|left|right)-${VALUE}|text-(left|right))$`,
);
/** A utility whose value comes from the template expression that follows it (`ml-${size}`). */
const PHYSICAL_PREFIX = /^(ml|mr|pl|pr|left|right)-$/;
const DIRECTION_VARIANTS = new Set(['rtl', 'ltr']);

/**
 * A class token's variants (`md`, `hover`) and its utility without `!` or a leading `-`. Colons
 * inside an arbitrary value (`[&:hover]`) do not split it.
 * @param {string} token
 * @returns {{ variants: string[], utility: string }}
 */
function parseToken(token) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of token) {
    if (character === '[' || character === '(') {
      depth += 1;
    } else if ((character === ']' || character === ')') && depth > 0) {
      depth -= 1;
    }
    if (character === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  const utility = current.replace(/^!/, '').replace(/!$/, '').replace(/^-/, '');
  return { variants: parts, utility };
}

/**
 * The logical replacement for a physical utility token, or `null` when the token is fine.
 * @param {string} token
 * @param {boolean} dangling the token's value is the template expression that follows it
 * @returns {string | null}
 */
function logicalReplacement(token, dangling) {
  const { variants, utility } = parseToken(token);
  if (variants.some((variant) => DIRECTION_VARIANTS.has(variant))) {
    return null;
  }
  const prefix = dangling ? PHYSICAL_PREFIX.exec(utility) : null;
  if (prefix?.[1] !== undefined) {
    return `${LOGICAL_FOR[/** @type {keyof typeof LOGICAL_FOR} */ (prefix[1])]}-`;
  }
  if (dangling) {
    return null;
  }
  const match = PHYSICAL_UTILITY.exec(utility);
  if (match === null) {
    return null;
  }
  if (match[2] !== undefined) {
    return match[2] === 'left' ? 'text-start' : 'text-end';
  }
  const physical = /** @type {keyof typeof LOGICAL_FOR} */ (match[1]);
  return `${LOGICAL_FOR[physical]}${utility.slice(physical.length)}`;
}

/** @type {import('eslint').Rule.RuleModule} */
const logicalPropertiesRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Refuse physical Tailwind utilities (ml-, mr-, pl-, pr-, left-, right-, text-left, text-right) in the flow and the shared UI (C161.3).',
    },
    schema: [],
    messages: {
      physical:
        '"{{token}}" is a physical utility, which does not mirror right to left; use the logical "{{logical}}" (C161.3).',
    },
  },
  create(context) {
    /**
     * @param {import('eslint').Rule.Node} node
     * @param {string} text
     * @param {boolean} followedByExpression
     */
    const check = (node, text, followedByExpression) => {
      const tokens = text.split(/\s+/);
      tokens.forEach((token, index) => {
        // eslint-disable-next-line security/detect-possible-timing-attacks -- an emptiness check of a class-name token, not a comparison of two secrets
        if (token === '') {
          return;
        }
        const dangling = followedByExpression && index === tokens.length - 1;
        const logical = logicalReplacement(token, dangling);
        if (logical !== null) {
          context.report({ node, messageId: 'physical', data: { token, logical } });
        }
      });
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          check(node, node.value, false);
        }
      },
      TemplateLiteral(node) {
        node.quasis.forEach((quasi, index) => {
          check(
            /** @type {import('eslint').Rule.Node} */ (/** @type {unknown} */ (node)),
            quasi.value.cooked ?? quasi.value.raw,
            index < node.expressions.length,
          );
        });
      },
    };
  },
};

/** @type {import('eslint').ESLint.Plugin} */
export const logicalPropertiesPlugin = {
  meta: { name: 'openverify-i18n' },
  rules: { 'logical-properties': logicalPropertiesRule },
};

/** @returns {import('eslint').Linter.Config[]} */
export function logicalPropertiesConfig() {
  return [
    {
      files: [...LOGICAL_PROPERTIES_FILES],
      plugins: { 'openverify-i18n': logicalPropertiesPlugin },
      rules: { 'openverify-i18n/logical-properties': 'error' },
    },
  ];
}
