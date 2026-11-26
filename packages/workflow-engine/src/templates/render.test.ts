/** C115.1, C115.2: templates are JSON values, and the sink, never the author, picks the encoding. */
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../expressions/json.js';
import { TEMPLATE_LIMITS } from '../limits/index.js';
import {
  checkUrlTemplate,
  parseTemplate,
  renderTemplate,
  type ParsedTemplate,
  type RenderScope,
  type TemplateSink,
} from './render.js';

function parsed(raw: JsonValue): ParsedTemplate {
  const result = parseTemplate(raw);
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.issues[0])}`);
  }
  return result.template;
}

const scope: RenderScope = {
  roots: {
    trigger: {
      id: 'inq_1',
      name: 'Ada <b>&',
      n: 3,
      yes: true,
      none: null,
      list: [1, 2],
      o: { a: 1 },
    },
    vars: { held: null },
    loop: { item: 'x' },
  },
};

const render = (raw: JsonValue, sink: TemplateSink = 'json', over: Partial<RenderScope> = {}) =>
  renderTemplate(parsed(raw), { ...scope, ...over }, sink);

const value = (result: JsonValue) => ({ ok: true, value: result });
const failed = (code: string) => ({ ok: false, code });

describe('parseTemplate (C115.1)', () => {
  it('finds every reference, with its pointer', () => {
    const template = parsed({ a: ['{{ trigger.id }}', 'x {{vars.held}} y {{ loop.item }}'], b: 1 });
    expect(template.references.map(({ path, pointer }) => [path.text, pointer])).toEqual([
      ['trigger.id', '/a/0'],
      ['vars.held', '/a/1'],
      ['loop.item', '/a/1'],
    ]);
  });

  it('reads a secret reference in both spellings (C125.3)', () => {
    const template = parsed(['{{secrets.api_key}}', '{{ current_run.environment.secrets.other }}']);
    expect(template.references.map(({ secret }) => secret)).toEqual(['api_key', 'other']);
  });

  it('leaves text with no reference alone', () => {
    expect(render('plain } text { only')).toEqual(value('plain } text { only'));
  });

  it.each<[string, JsonValue, string]>([
    ['an unclosed reference', '{{ trigger.id', 'template_invalid'],
    ['an empty reference', '{{ }}', 'template_invalid'],
    ['a helper', '{{#if trigger.id}}', 'template_invalid'],
    ['a filter', '{{ trigger.id | upper }}', 'template_invalid'],
    ['a call', '{{ trigger.id() }}', 'template_invalid'],
    ['a prototype path', '{{ trigger.__proto__ }}', 'template_invalid'],
    ['a triple brace', '{{{ trigger.id }}}', 'template_invalid'],
    ['an unknown root', '{{ process.env }}', 'path_unknown'],
    ['a secret with no key', '{{ secrets }}', 'template_invalid'],
    ['a secret path too long', '{{ secrets.a.b }}', 'template_invalid'],
  ])('refuses %s', (_label, raw, code) => {
    const result = parseTemplate(raw);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toEqual([code]);
  });

  it('refuses a template past its cap', () => {
    const result = parseTemplate('a'.repeat(TEMPLATE_LIMITS['template-bytes'].value + 1));
    expect(result.ok ? [] : result.issues.map(({ code }) => code)).toEqual(['template_too_large']);
  });

  it('takes a cap of its own for a member that has one', () => {
    const raw = 'a'.repeat(TEMPLATE_LIMITS['template-bytes'].value + 1);
    expect(parseTemplate(raw, { maxBytes: 64 * 1024 }).ok).toBe(true);
    expect(parseTemplate(raw, { maxBytes: 8 }).ok).toBe(false);
  });

  it('refuses one nested past reason, without recursing into it', () => {
    let raw: JsonValue = 'x';
    for (let level = 0; level < 100_000; level += 1) {
      raw = [raw];
    }
    const result = parseTemplate(raw);
    expect(result.ok ? [] : result.issues.map(({ code }) => code)).toEqual(['template_too_large']);
  });

  it('quotes nothing it was given', () => {
    const canary = 'change-me-canary-template';
    expect(JSON.stringify(parseTemplate(`{{ ${canary} | x }}`))).not.toContain(canary);
  });
});

describe('JSON values (C115.1)', () => {
  it.each<[string, JsonValue, JsonValue]>([
    ['a leaf that is one reference keeps its number', '{{ trigger.n }}', 3],
    ['its boolean', '{{ trigger.yes }}', true],
    ['its list', '{{ trigger.list }}', [1, 2]],
    ['its object', '{{ trigger.o }}', { a: 1 }],
    ['its null', '{{ trigger.none }}', null],
    ['spaces do not matter', '{{trigger.n}}', 3],
    ['other leaves interpolate', 'n={{ trigger.n }}/{{ trigger.yes }}', 'n=3/true'],
    ['values nest', { a: { b: ['{{ trigger.n }}'] } }, { a: { b: [3] } }],
    ['literals stay', { a: 1, b: null, c: false }, { a: 1, b: null, c: false }],
  ])('%s', (_label, raw, expected) => {
    expect(render(raw)).toEqual(value(expected));
  });

  it('a value can never break out of a JSON string', () => {
    const roots = { trigger: { evil: '"}, "admin": true, "x": {"' } };
    const rendered = render({ note: 'id {{ trigger.evil }}' }, 'json', { roots });
    expect(JSON.parse(JSON.stringify(rendered))).toEqual(
      value({ note: 'id "}, "admin": true, "x": {"' }),
    );
  });

  it('builds a member by name, never off the prototype', () => {
    const raw = JSON.parse('{"__proto__": "{{ trigger.n }}"}') as JsonValue;
    const rendered = render(raw);
    expect(rendered.ok && Object.getPrototypeOf(rendered.value)).toBe(Object.prototype);
    expect(JSON.stringify(rendered)).toContain('"__proto__":3');
  });
});

describe('what a missing value does (C115.2)', () => {
  it.each<[string, JsonValue]>([
    ['an exact reference to an absent member', '{{ trigger.absent }}'],
    ['an interpolation of an absent member', 'x{{ trigger.absent }}'],
    ['an interpolation of a null', 'x{{ trigger.none }}'],
    ['an absent root', '{{ current_case.status }}'],
  ])('%s is a step error, never an empty string', (_label, raw) => {
    expect(render(raw)).toEqual(failed('template_variable_missing'));
  });

  it('reading a variable before it holds a value is its own error (C115.4)', () => {
    expect(render('{{ vars.unset }}')).toEqual(failed('variable_unset'));
    expect(render('a{{ vars.unset }}')).toEqual(failed('variable_unset'));
  });

  it('reads a variable that holds null as null', () => {
    expect(render('{{ vars.held }}')).toEqual(value(null));
  });

  it('a text sink takes no null at all', () => {
    expect(render('{{ trigger.none }}', 'text')).toEqual(failed('template_variable_missing'));
  });

  it.each<[string, JsonValue]>([
    ['a list', 'x{{ trigger.list }}'],
    ['an object', 'x{{ trigger.o }}'],
  ])('%s has no text form', (_label, raw) => {
    expect(render(raw)).toEqual(failed('template_type_mismatch'));
  });

  it('a text sink takes no object even as an exact reference', () => {
    expect(render('{{ trigger.o }}', 'text')).toEqual(failed('template_type_mismatch'));
  });
});

describe('the encoders (C115.2)', () => {
  it('text inserts as text', () => {
    expect(render('Hi {{ trigger.name }}', 'text')).toEqual(value('Hi Ada <b>&'));
    expect(render('{{ trigger.n }}', 'text')).toEqual(value('3'));
  });

  it('email HTML escapes every interpolated value and leaves the author alone', () => {
    const roots = { trigger: { name: `<script>"&'` } };
    expect(render('<p>{{ trigger.name }}</p>', 'email-html', { roots })).toEqual(
      value('<p>&lt;script&gt;&quot;&amp;&#39;</p>'),
    );
  });

  it('Slack text escapes the three characters that make a mention', () => {
    const roots = { trigger: { name: '<!channel> & co' } };
    expect(render('Hi <@U1> {{ trigger.name }}', 'slack-text', { roots })).toEqual(
      value('Hi <@U1> &lt;!channel&gt; &amp; co'),
    );
  });

  it.each(['a\r\nX-Evil: 1', 'a\nb', 'a\rb', 'a\u0000b'])('a header refuses %j', (bad) => {
    const roots = { trigger: { bad } };
    expect(render('Bearer {{ trigger.bad }}', 'header', { roots })).toEqual(
      failed('template_value_refused'),
    );
  });

  it('a header takes a plain value', () => {
    expect(render('Bearer {{ trigger.id }}', 'header')).toEqual(value('Bearer inq_1'));
  });

  it('a sink holds a rendered value to its smaller cap', () => {
    const rendered = renderTemplate(parsed('{{ trigger.id }}'), scope, 'text', { maxBytes: 3 });
    expect(rendered).toEqual(failed('payload_too_large'));
  });

  it('holds every sink to the rendered cap', () => {
    const huge = 'a'.repeat(TEMPLATE_LIMITS['rendered-bytes'].value + 1);
    const roots = { trigger: { huge } };
    expect(render({ a: '{{ trigger.huge }}' }, 'json', { roots })).toEqual(
      failed('payload_too_large'),
    );
    expect(render('{{ trigger.huge }}', 'text', { roots })).toEqual(failed('payload_too_large'));
  });

  it('counts the cap in bytes', () => {
    const roots = { trigger: { text: 'é' } };
    const rendered = renderTemplate(parsed('{{ trigger.text }}'), { ...scope, roots }, 'text', {
      maxBytes: 1,
    });
    expect(rendered).toEqual(failed('payload_too_large'));
  });
});

describe('the URL sink (C115.2, C124.3)', () => {
  const url = (raw: string, roots: RenderScope['roots'] = scope.roots) =>
    renderTemplate(parsed(raw), { roots }, 'url');
  const issues = (raw: string) => checkUrlTemplate(parsed(raw)).map(({ code }) => code);

  it('percent-encodes an interpolation as one path segment', () => {
    const roots = { trigger: { id: 'a/b?c#d e' } };
    expect(url('https://api.example.com/v1/{{ trigger.id }}/x', roots)).toEqual(
      value('https://api.example.com/v1/a%2Fb%3Fc%23d%20e/x'),
    );
  });

  it('percent-encodes an interpolation as one query value', () => {
    const roots = { trigger: { id: 'a&b=c' } };
    expect(url('https://api.example.com/v1?x=1&id={{ trigger.id }}', roots)).toEqual(
      value('https://api.example.com/v1?x=1&id=a%26b%3Dc'),
    );
  });

  it.each(['.', '..'])('refuses %s as a whole path segment', (id) => {
    const roots = { trigger: { id } };
    expect(url('https://api.example.com/v1/{{ trigger.id }}/x', roots)).toEqual(
      failed('template_value_refused'),
    );
  });

  it('takes a dot inside a segment', () => {
    const roots = { trigger: { id: 'a.b' } };
    expect(url('https://api.example.com/{{ trigger.id }}', roots)).toEqual(
      value('https://api.example.com/a.b'),
    );
  });

  it('leaves a literal URL alone', () => {
    expect(issues('https://api.example.com/v1')).toEqual([]);
    expect(url('https://api.example.com/v1')).toEqual(value('https://api.example.com/v1'));
  });

  it('refuses a secret anywhere in a URL at run time', () => {
    const rendered = renderTemplate(
      parsed('https://api.example.com/{{ secrets.k }}'),
      { ...scope, secrets: { k: 'change-me' } },
      'url',
    );
    expect(rendered).toEqual(failed('secret_placement_refused'));
  });

  it.each<[string, string]>([
    [
      'a path and a query value',
      'https://api.example.com:8443/a/{{ trigger.id }}?q={{ trigger.n }}',
    ],
    ['the end of a path', 'https://api.example.com/{{ trigger.id }}'],
    ['part of a segment', 'https://api.example.com/x-{{ trigger.id }}-y'],
  ])('admits %s', (_label, raw) => {
    expect(issues(raw)).toEqual([]);
  });

  it.each<[string, string, string]>([
    ['a host from a value', 'https://{{ trigger.id }}.example.com/x', 'url_host_not_literal'],
    ['a scheme from a value', '{{ trigger.id }}://example.com/', 'url_host_not_literal'],
    ['a whole URL from a value', '{{ trigger.id }}', 'url_host_not_literal'],
    ['a port from a value', 'https://example.com:{{ trigger.n }}/x', 'url_host_not_literal'],
    [
      'a value straight after the host',
      'https://example.com{{ trigger.id }}',
      'url_host_not_literal',
    ],
    ['plain http', 'http://example.com/{{ trigger.id }}', 'url_scheme_refused'],
    ['credentials', 'https://user:pw@example.com/x', 'url_credentials_refused'],
    [
      'a query key from a value',
      'https://example.com/x?{{ trigger.id }}=1',
      'url_position_refused',
    ],
    ['a fragment from a value', 'https://example.com/x#{{ trigger.id }}', 'url_position_refused'],
    ['no URL at all', 'not a url', 'url_invalid'],
  ])('refuses %s', (_label, raw, code) => {
    expect(issues(raw)).toEqual([code]);
  });

  it('refuses a URL that is no text', () => {
    expect(checkUrlTemplate(parsed({ a: 1 })).map(({ code }) => code)).toEqual(['url_invalid']);
  });
});

describe('secrets (C125.3, C125.5)', () => {
  const secrets = { api_key: 'change-me-canary-secret' };

  it('resolve into a header', () => {
    const rendered = renderTemplate(
      parsed('Bearer {{ secrets.api_key }}'),
      { ...scope, secrets },
      'header',
    );
    expect(rendered).toEqual(value('Bearer change-me-canary-secret'));
  });

  it('resolve into a JSON body', () => {
    const rendered = renderTemplate(
      parsed({ key: '{{ secrets.api_key }}' }),
      { ...scope, secrets },
      'json',
    );
    expect(rendered).toEqual(value({ key: 'change-me-canary-secret' }));
  });

  it('resolve the public spelling the same way', () => {
    const raw = 'Bearer {{ current_run.environment.secrets.api_key }}';
    expect(renderTemplate(parsed(raw), { ...scope, secrets }, 'header')).toEqual(
      value('Bearer change-me-canary-secret'),
    );
  });

  it.each<TemplateSink>(['text', 'email-html', 'slack-text', 'url'])(
    'never reach the %s sink',
    (sink) => {
      const raw =
        sink === 'url' ? 'https://example.com/{{ secrets.api_key }}' : '{{ secrets.api_key }}';
      expect(renderTemplate(parsed(raw), { ...scope, secrets }, sink)).toEqual(
        failed('secret_placement_refused'),
      );
    },
  );

  it('with no value is missing, never an empty string', () => {
    expect(renderTemplate(parsed('{{ secrets.other }}'), { ...scope, secrets }, 'header')).toEqual(
      failed('template_variable_missing'),
    );
  });

  it('read no key off the prototype', () => {
    expect(
      renderTemplate(parsed('{{ secrets.toString }}'), { ...scope, secrets }, 'header'),
    ).toEqual(failed('template_variable_missing'));
  });
});
