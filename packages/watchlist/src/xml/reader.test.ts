/**
 * C77.2: the guarded XML reader. Every document here is synthetic and written by the test; the
 * hostile ones are the classic attacks (entity expansion, external entities, deep nesting) and
 * the caps the plan names (node, attribute and byte caps, truncation, encoding).
 */
import { describe, expect, it } from 'vitest';
import { WatchlistParseError } from '../parsers/errors.js';
import { readXml, type ByteSource, type ReadXmlOptions, type XmlEvent } from './reader.js';

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** The bytes of `text`, cut into pieces of `size` bytes (multi-byte characters split too). */
function* pieces(data: Uint8Array, size: number): Generator<Uint8Array> {
  for (let offset = 0; offset < data.length; offset += size) {
    yield data.subarray(offset, offset + size);
  }
}

async function collect(source: ByteSource, options: ReadXmlOptions): Promise<XmlEvent[]> {
  const events: XmlEvent[] = [];
  for await (const event of readXml(source, options)) {
    events.push(event);
  }
  return events;
}

async function refusal(source: ByteSource, options: ReadXmlOptions): Promise<WatchlistParseError> {
  try {
    await collect(source, options);
  } catch (error) {
    expect(error).toBeInstanceOf(WatchlistParseError);
    return error as WatchlistParseError;
  }
  throw new Error('the document was not refused');
}

const OPTIONS: ReadXmlOptions = {
  maxBytes: 1_000_000,
  capture: ['list/header', 'list/entries/entry'],
};

const LIST = `<?xml version="1.0" encoding="UTF-8"?>
<list xmlns="urn:example:list" generated="2026-10-21T00:00:00Z">
  <header><published>2026-10-21</published></header>
  <entries>
    <entry id="1"><name kind="primary">QUILLFEATHER, Avery &amp; Co</name><note><![CDATA[a < b]]></note></entry>
    <entry id="2"><name>Квиллфезер Эйвери</name><x:extra xmlns:x="urn:example:x">&#x41;&#66;</x:extra></entry>
  </entries>
</list>`;

describe('readXml', () => {
  it('yields the root, then each captured element in document order, by local name', async () => {
    const events = await collect([bytes(LIST)], OPTIONS);
    expect(events.map((event) => event.kind)).toEqual(['root', 'element', 'element', 'element']);
    const [root, header, first, second] = events;
    expect(root).toMatchObject({
      kind: 'root',
      namespace: 'urn:example:list',
      element: { name: 'list', attributes: { generated: '2026-10-21T00:00:00Z' }, children: [] },
    });
    expect(header).toMatchObject({ kind: 'element', path: 'list/header' });
    expect(first).toEqual({
      kind: 'element',
      path: 'list/entries/entry',
      element: {
        name: 'entry',
        attributes: { id: '1' },
        text: '',
        children: [
          {
            name: 'name',
            attributes: { kind: 'primary' },
            children: [],
            text: 'QUILLFEATHER, Avery & Co',
          },
          { name: 'note', attributes: {}, children: [], text: 'a < b' },
        ],
      },
    });
    expect(second).toMatchObject({
      element: {
        children: [
          { name: 'name', text: 'Квиллфезер Эйвери' },
          { name: 'extra', text: 'AB' },
        ],
      },
    });
  });

  it('reads the same document whatever the chunk boundaries, multi-byte characters included', async () => {
    const whole = await collect([bytes(LIST)], OPTIONS);
    for (const size of [1, 2, 3, 7, 64]) {
      expect(await collect(pieces(bytes(LIST), size), OPTIONS)).toEqual(whole);
    }
  });

  it('accepts an XML 1.1 declaration, a UTF-8 byte order mark and a prefixed root', async () => {
    const xml11 = `<?xml version="1.1" encoding="utf-8"?><list><entries><entry id="1"/></entries></list>`;
    expect(await collect([bytes(xml11)], OPTIONS)).toHaveLength(2);
    const bom = Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes('<list><header/></list>'));
    expect(await collect([bom], OPTIONS)).toHaveLength(2);
    const prefixed = '<p:list xmlns:p="urn:example:p"><p:header/></p:list>';
    expect(await collect([bytes(prefixed)], OPTIONS)).toMatchObject([
      { kind: 'root', namespace: 'urn:example:p', element: { name: 'list' } },
      { kind: 'element', path: 'list/header' },
    ]);
  });

  it('hands over each captured element before reading further input', async () => {
    function* source(): Generator<Uint8Array> {
      yield bytes('<list><entries><entry id="1"/>');
      throw new Error('the next chunk was read too early');
    }
    const reader = readXml(source(), OPTIONS);
    expect((await reader.next()).value).toMatchObject({ kind: 'root' });
    expect((await reader.next()).value).toMatchObject({ element: { attributes: { id: '1' } } });
    await reader.return(undefined);
  });

  describe('refuses, fails closed and names no value', () => {
    it('refuses a DOCTYPE, so entity expansion and external entities never happen', async () => {
      const laughs =
        '<?xml version="1.0"?><!DOCTYPE list [<!ENTITY a "QUILLFEATHER">' +
        '<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>' +
        '<list><header>&c;</header></list>';
      const external =
        '<?xml version="1.0"?><!DOCTYPE list [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' +
        '<list><header>&secret;</header></list>';
      const bare = '<!DOCTYPE list><list/>';
      for (const document of [laughs, external, bare]) {
        const error = await refusal([bytes(document)], OPTIONS);
        expect(error.code).toBe('doctype');
        expect(error.message).not.toContain('QUILLFEATHER');
      }
    });

    it('refuses a DOCTYPE at its start, before its internal subset is read (R008)', async () => {
      let pulled = 0;
      function* subset(): Generator<Uint8Array> {
        yield bytes('<?xml version="1.0"?><!DOCTYPE r [');
        for (;;) {
          pulled += 1;
          yield bytes('<!ENTITY a "b">'.repeat(64));
        }
      }
      const error = await refusal(subset(), OPTIONS);
      expect(error.code).toBe('doctype');
      expect(pulled).toBeLessThan(4);
      for (const size of [1, 3, 7]) {
        const document = bytes('<!DOCTYPE list [<!ENTITY a "b">]><list/>');
        expect((await refusal(pieces(document, size), OPTIONS)).code).toBe('doctype');
      }
    });

    it('bounds a text run or an attribute value that is full of ">" before buffering it (R008)', async () => {
      const options = { ...OPTIONS, limits: { maxNodeLength: 100 } };
      const openers = ['<list><header>', '<list><header a="', "<list><header a='"];
      for (const opener of openers) {
        let pulled = 0;
        const source = function* (): Generator<Uint8Array> {
          yield bytes(opener);
          for (;;) {
            pulled += 1;
            yield bytes('a>'.repeat(64));
          }
        };
        const error = await refusal(source(), options);
        expect(error.code).toBe('too_long');
        expect(error.message).not.toContain('a>a>');
        expect(pulled).toBeLessThan(4);
      }
      const legal = `<list><header a="${'>'.repeat(40)}">${'Q>'.repeat(40)}</header></list>`;
      await expect(collect(pieces(bytes(legal), 5), options)).resolves.toHaveLength(2);
    });

    it('refuses a markup declaration that opens neither a comment nor a CDATA section (R008)', async () => {
      for (const document of [
        '<list><!ENTITY a "b"></list>',
        '<list><!-x--></list>',
        '<list><![CDAT[x]]></list>',
      ]) {
        expect((await refusal(pieces(bytes(document), 2), OPTIONS)).code).toBe('malformed');
      }
      const terminators =
        '<list><!-- a->b --><?note a?b>c?><header><![CDATA[a]b]]]></header></list>';
      await expect(collect(pieces(bytes(terminators), 1), OPTIONS)).resolves.toHaveLength(2);
    });

    it('refuses an entity beyond the predefined five', async () => {
      const error = await refusal([bytes('<list><header>&nbsp;</header></list>')], OPTIONS);
      expect(error.code).toBe('malformed');
    });

    it('refuses nesting deeper than the cap and accepts it at the cap', async () => {
      const nested = (depth: number) => '<a>'.repeat(depth) + '</a>'.repeat(depth);
      await expect(collect([bytes(nested(64))], OPTIONS)).resolves.toHaveLength(1);
      expect((await refusal([bytes(nested(65))], OPTIONS)).code).toBe('too_deep');
      const deep = nested(100_000);
      expect((await refusal(pieces(bytes(deep), 4096), OPTIONS)).code).toBe('too_deep');
    });

    it('refuses a text run, a tag, an attribute or an attribute list over its cap', async () => {
      const limits = { maxNodeLength: 100, maxAttributeLength: 20, maxAttributes: 3 };
      const options = { ...OPTIONS, limits };
      const text = `<list><header>${'Q'.repeat(101)}</header></list>`;
      const tag = `<list><header ${'a'.repeat(101)}="1"/></list>`;
      const attribute = `<list><header a="${'Q'.repeat(21)}"/></list>`;
      const many = '<list><header a="1" b="2" c="3" d="4"/></list>';
      for (const document of [text, tag, attribute, many]) {
        const error = await refusal(pieces(bytes(document), 16), options);
        expect(error.code).toBe('too_long');
        expect(error.message).not.toContain('QQQ');
      }
      await expect(
        collect(
          [bytes(`<list><header a="${'Q'.repeat(20)}">${'Q'.repeat(90)}</header></list>`)],
          options,
        ),
      ).resolves.toHaveLength(2);
    });

    it('refuses a comment, an instruction or a CDATA section over the cap, markup inside or not', async () => {
      const options = { ...OPTIONS, limits: { maxNodeLength: 100 } };
      const filler = 'Q>'.repeat(60);
      const documents = [
        `<list><!--${filler}--></list>`,
        `<list><?note ${filler}?></list>`,
        `<list><header><![CDATA[${filler}]]></header></list>`,
      ];
      for (const document of documents) {
        expect((await refusal([bytes(document)], options)).code).toBe('too_long');
      }
      const short = '<list><!--Q--><?note Q?><header><![CDATA[Q>]]></header></list>';
      await expect(collect([bytes(short)], options)).resolves.toHaveLength(2);
    });

    it('refuses a captured element holding more elements than the cap', async () => {
      const document = `<list><entries><entry>${'<n/>'.repeat(10)}</entry></entries></list>`;
      const error = await refusal([bytes(document)], {
        ...OPTIONS,
        limits: { maxCapturedElements: 10 },
      });
      expect(error.code).toBe('too_long');
    });

    it('refuses more bytes than the cap and stops reading the source', async () => {
      let pulled = 0;
      function* source(): Generator<Uint8Array> {
        yield bytes('<list><entries>');
        for (;;) {
          pulled += 1;
          yield bytes('<entry id="1"/>');
        }
      }
      const error = await refusal(source(), { ...OPTIONS, maxBytes: 1000 });
      expect(error.code).toBe('too_large');
      expect(error.refusal).toBe('refused_size');
      expect(pulled).toBeLessThan(70);
    });

    it('refuses a truncated document, text outside the root, two roots and no root', async () => {
      const documents = [
        LIST.slice(0, LIST.length - 20),
        '<list><header/></list>trailing',
        '<list/><list/>',
        '',
        '   ',
        '<list><header></list></header>',
      ];
      for (const document of documents) {
        expect((await refusal([bytes(document)], OPTIONS)).code).toBe('malformed');
      }
    });

    it('refuses bytes that are not UTF-8 and declarations of another encoding', async () => {
      const latin1 = Uint8Array.of(...bytes('<list><header>'), 0xe9, ...bytes('</header></list>'));
      const utf16 = Uint8Array.of(0xff, 0xfe, 0x3c, 0x00, 0x6c, 0x00);
      const declared = bytes('<?xml version="1.0" encoding="ISO-8859-1"?><list/>');
      const cut = bytes('<list><header>Квиллфезер</header></list>').subarray(0, 17);
      for (const source of [[latin1], [utf16], [declared], [cut]]) {
        expect((await refusal(source, OPTIONS)).code).toBe('encoding');
      }
    });

    it('gives positions, never content, in its messages', async () => {
      const error = await refusal(
        [bytes('<list><header>QUILLFEATHER &bogus;</header></list>')],
        OPTIONS,
      );
      expect(error.message).toMatch(/^malformed: line \d+, column \d+/u);
      expect(error.message).not.toContain('QUILLFEATHER');
      expect(error.message).not.toContain('bogus');
    });
  });
});
