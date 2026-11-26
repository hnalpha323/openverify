/**
 * C77.2: the guarded, streaming XML reader every list parser goes through. It reads UTF-8 bytes
 * through `saxes` and hands over, one at a time, the elements whose paths the caller captures
 * (a list's header and each of its entries), so no whole list is ever held in memory.
 */
import { SaxesParser } from 'saxes';
import { WatchlistParseError, type WatchlistParseErrorCode } from '../parsers/errors.js';

/** C77.2: the reader's caps (ours, provisional). The total byte cap comes from the manifest. */
export const XML_GUARD_LIMITS = Object.freeze({
  /** Element nesting: no list we read goes deeper than about ten. */
  maxDepth: 64,
  /** Characters of one text run or one tag, between two markup delimiters. */
  maxNodeLength: 262_144,
  /** Characters of one attribute value. */
  maxAttributeLength: 65_536,
  /** Attributes on one element. */
  maxAttributes: 256,
  /** Elements in one captured element (an entry, or a header such as OFAC's reference values). */
  maxCapturedElements: 200_000,
});
export type XmlGuardLimits = { readonly [Key in keyof typeof XML_GUARD_LIMITS]: number };

/** A captured element: its local name, attributes by local name, children and direct text. */
export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** The concatenated text and CDATA directly inside the element, as written. */
  readonly text: string;
}

/** What the reader hands over: the root element first (without children), then each capture. */
export type XmlEvent =
  | {
      readonly kind: 'root';
      readonly element: XmlElement;
      /** The namespace URI bound to the root element's prefix, or null. */
      readonly namespace: string | null;
    }
  | { readonly kind: 'element'; readonly path: string; readonly element: XmlElement };

export interface ReadXmlOptions {
  /** The total byte cap (the manifest's `max_bytes`); more refuses with `too_large`. */
  readonly maxBytes: number;
  /** Local-name paths from the root, such as `sanctionsData/entities/entity`, captured whole. */
  readonly capture: readonly string[];
  readonly limits?: Partial<XmlGuardLimits>;
}

/** Bytes a source may yield: a Node stream, an async generator or plain chunks. */
export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

/**
 * Reads an XML document and yields its root, then every captured element in document order.
 * @throws {WatchlistParseError} for a DOCTYPE, an undefined entity, a cap passed, malformed or
 * truncated XML, or bytes that are not UTF-8.
 */
export async function* readXml(
  source: ByteSource,
  options: ReadXmlOptions,
): AsyncGenerator<XmlEvent, void, undefined> {
  const reader = new GuardedReader(options);
  for await (const chunk of source) {
    for (let offset = 0; offset < chunk.length; offset += SLICE_BYTES) {
      reader.write(chunk.subarray(offset, offset + SLICE_BYTES));
      yield* reader.drain();
    }
  }
  reader.end();
  yield* reader.drain();
}

/** Bytes handed to the decoder and the parser at a time, so one huge chunk queues little. */
const SLICE_BYTES = 65_536;

const LESS_THAN = 0x3c;
const GREATER_THAN = 0x3e;
const BANG = 0x21;
const QUESTION = 0x3f;
const DASH = 0x2d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const UPPER_D = 0x44;
const UTF8_LABEL = /^utf-?8$/iu;
/** What follows `<![` in a CDATA section's opener. */
const CDATA_OPENER = 'CDATA[';

/**
 * R008: the lexical context the pre-scan is in, carried across chunks, so a construct is
 * measured from its opening `<` (or from the end of the last markup, for text) to its end.
 */
type Lexeme =
  | 'text'
  | 'open'
  | 'bang'
  | 'bang-dash'
  | 'cdata-opener'
  | 'tag'
  | 'comment'
  | 'cdata'
  | 'instruction';

const LEXEME_WORDS: Readonly<Record<Lexeme, string>> = {
  text: 'a text run',
  open: 'a tag',
  bang: 'a markup declaration',
  'bang-dash': 'a comment',
  'cdata-opener': 'a CDATA section',
  tag: 'a tag',
  comment: 'a comment',
  cdata: 'a CDATA section',
  instruction: 'a processing instruction',
};

interface Builder {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlElement[];
  readonly text: string[];
}

function localName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

/** One document's decoder, `saxes` parser, guards and capture state. */
class GuardedReader {
  private readonly limits: XmlGuardLimits;
  private readonly capture: ReadonlySet<string>;
  private readonly maxBytes: number;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly parser = new SaxesParser<{ xmlns: false; position: true }>({
    xmlns: false,
    position: true,
  });
  private readonly queue: XmlEvent[] = [];
  /** Local names of the open elements, root first. */
  private readonly open: string[] = [];
  /** The open elements of the current capture; empty outside one. */
  private readonly builders: Builder[] = [];
  private capturePath = '';
  private captured = 0;
  private sawRoot = false;
  /**
   * R008: characters of the construct being read (a text run, a tag with its attribute values, a
   * comment, a CDATA section or an instruction), so none is buffered past the cap by saxes. A `>`
   * inside text, a quoted value, a comment or a CDATA section is an ordinary character here.
   */
  private run = 0;
  private lexeme: Lexeme = 'text';
  /** In a tag: the quote of the open attribute value, or 0. */
  private quote = 0;
  /** In a comment, a CDATA section or an instruction: how much of its terminator was just read. */
  private closing = 0;
  private bytes = 0;

  constructor(options: ReadXmlOptions) {
    this.limits = { ...XML_GUARD_LIMITS, ...options.limits };
    this.capture = new Set(options.capture);
    this.maxBytes = options.maxBytes;
    const parser = this.parser;
    parser.on('error', (error) => {
      this.fail('malformed', error.message.replace(/^\d+:\d+: /u, ''));
    });
    parser.on('doctype', () => {
      this.fail('doctype', 'a DOCTYPE declaration is refused');
    });
    parser.on('xmldecl', (declaration) => {
      if (declaration.encoding !== undefined && !UTF8_LABEL.test(declaration.encoding)) {
        this.fail('encoding', 'the declared encoding is not UTF-8');
      }
    });
    parser.on('opentag', (tag) => {
      this.openElement(tag.name, tag.attributes);
    });
    parser.on('closetag', () => {
      this.closeElement();
    });
    parser.on('text', (text) => {
      this.addText(text);
    });
    parser.on('cdata', (text) => {
      this.addText(text);
    });
    parser.on('comment', (comment) => {
      this.checkLength(comment.length, 'a comment');
    });
    parser.on('processinginstruction', (instruction) => {
      this.checkLength(instruction.body.length, 'a processing instruction');
    });
  }

  write(bytes: Uint8Array): void {
    this.bytes += bytes.length;
    if (this.bytes > this.maxBytes) {
      throw new WatchlistParseError(
        'too_large',
        `the document is over ${String(this.maxBytes)} bytes`,
      );
    }
    this.parse(this.decode(bytes));
  }

  end(): void {
    this.parse(this.decode(undefined));
    this.parser.close();
  }

  *drain(): Generator<XmlEvent, void, undefined> {
    yield* this.queue.splice(0);
  }

  private decode(bytes: Uint8Array | undefined): string {
    try {
      return bytes === undefined
        ? this.decoder.decode()
        : this.decoder.decode(bytes, { stream: true });
    } catch (error) {
      throw new WatchlistParseError(
        'encoding',
        `the bytes are not UTF-8 after ${String(this.bytes)} bytes`,
        {
          cause: error,
        },
      );
    }
  }

  private parse(text: string): void {
    const limit = this.limits.maxNodeLength;
    for (let index = 0; index < text.length; index += 1) {
      this.scan(text.charCodeAt(index));
      if (this.run > limit) {
        this.fail('too_long', `${LEXEME_WORDS[this.lexeme]} is longer than the cap`);
      }
    }
    this.parser.write(text);
  }

  /**
   * R008: one character of the pre-scan. A DOCTYPE is refused at `<!D`, before saxes buffers its
   * internal subset; any other `<!` that opens neither a comment nor a CDATA section is malformed.
   */
  private scan(code: number): void {
    switch (this.lexeme) {
      case 'text':
        if (code === LESS_THAN) {
          this.enter('open');
        } else {
          this.run += 1;
        }
        return;
      case 'open':
        this.run += 1;
        if (code === BANG) {
          this.lexeme = 'bang';
        } else if (code === QUESTION) {
          this.enter('instruction');
        } else {
          this.lexeme = 'tag';
          this.scanTag(code);
        }
        return;
      case 'bang':
        this.run += 1;
        if (code === DASH) {
          this.lexeme = 'bang-dash';
        } else if (code === OPEN_BRACKET) {
          this.lexeme = 'cdata-opener';
          this.closing = 0;
        } else if (code === UPPER_D) {
          this.fail('doctype', 'a DOCTYPE declaration is refused');
        } else {
          this.fail('malformed', 'a markup declaration other than a comment or CDATA');
        }
        return;
      case 'bang-dash':
        if (code !== DASH) {
          this.fail('malformed', 'a markup declaration other than a comment or CDATA');
        }
        this.enter('comment');
        return;
      case 'cdata-opener':
        this.run += 1;
        if (code !== CDATA_OPENER.charCodeAt(this.closing)) {
          this.fail('malformed', 'a markup declaration other than a comment or CDATA');
        }
        this.closing += 1;
        if (this.closing === CDATA_OPENER.length) {
          this.enter('cdata');
        }
        return;
      case 'tag':
        this.run += 1;
        this.scanTag(code);
        return;
      case 'comment':
        this.run += 1;
        this.scanTerminator(code, DASH, 2);
        return;
      case 'cdata':
        this.run += 1;
        this.scanTerminator(code, CLOSE_BRACKET, 2);
        return;
      case 'instruction':
        this.run += 1;
        this.scanTerminator(code, QUESTION, 1);
        return;
    }
  }

  /** A tag ends at a `>` outside a quoted attribute value. */
  private scanTag(code: number): void {
    if (this.quote !== 0) {
      if (code === this.quote) {
        this.quote = 0;
      }
    } else if (code === QUOTE || code === APOSTROPHE) {
      this.quote = code;
    } else if (code === GREATER_THAN) {
      this.enter('text');
    }
  }

  /** A comment (`-->`), a CDATA section (`]]>`) or an instruction (`?>`) ends at its terminator. */
  private scanTerminator(code: number, mark: number, marks: number): void {
    if (code === GREATER_THAN && this.closing >= marks) {
      this.enter('text');
    } else {
      this.closing = code === mark ? this.closing + 1 : 0;
    }
  }

  private enter(lexeme: Lexeme): void {
    this.lexeme = lexeme;
    this.run = 0;
    this.quote = 0;
    this.closing = 0;
  }

  private openElement(qualified: string, attributes: Record<string, string>): void {
    if (this.open.length >= this.limits.maxDepth) {
      this.fail('too_deep', `elements nest deeper than ${String(this.limits.maxDepth)}`);
    }
    const names = Object.keys(attributes);
    if (names.length > this.limits.maxAttributes) {
      this.fail('too_long', 'an element has more attributes than the cap');
    }
    const plain: Record<string, string> = {};
    const declarations = new Map<string, string>();
    for (const name of names) {
      const value = attributes[name] ?? '';
      if (value.length > this.limits.maxAttributeLength) {
        this.fail('too_long', 'an attribute value is longer than the cap');
      }
      if (name === 'xmlns' || name.startsWith('xmlns:')) {
        declarations.set(name, value);
      } else if (localName(name) !== '__proto__') {
        plain[localName(name)] = value;
      }
    }
    const name = localName(qualified);
    this.open.push(name);
    if (!this.sawRoot) {
      this.sawRoot = true;
      const colon = qualified.indexOf(':');
      const binding = colon === -1 ? 'xmlns' : `xmlns:${qualified.slice(0, colon)}`;
      this.queue.push({
        kind: 'root',
        element: { name, attributes: plain, children: [], text: '' },
        namespace: declarations.get(binding) ?? null,
      });
    }
    if (this.builders.length === 0) {
      const path = this.open.join('/');
      if (!this.capture.has(path)) {
        return;
      }
      this.capturePath = path;
      this.captured = 0;
    }
    this.captured += 1;
    if (this.captured > this.limits.maxCapturedElements) {
      this.fail('too_long', 'a captured element holds more elements than the cap');
    }
    this.builders.push({ name, attributes: plain, children: [], text: [] });
  }

  private closeElement(): void {
    this.open.pop();
    const builder = this.builders.pop();
    if (builder === undefined) {
      return;
    }
    const element: XmlElement = {
      name: builder.name,
      attributes: builder.attributes,
      children: builder.children,
      text: builder.text.join(''),
    };
    const parent = this.builders.at(-1);
    if (parent === undefined) {
      this.queue.push({ kind: 'element', path: this.capturePath, element });
    } else {
      parent.children.push(element);
    }
  }

  private addText(text: string): void {
    this.checkLength(text.length, 'a text node');
    this.builders.at(-1)?.text.push(text);
  }

  private checkLength(length: number, what: string): void {
    if (length > this.limits.maxNodeLength) {
      this.fail('too_long', `${what} is longer than the cap`);
    }
  }

  private fail(code: WatchlistParseErrorCode, rule: string): never {
    const { line, column } = this.parser;
    throw new WatchlistParseError(code, `line ${String(line)}, column ${String(column)}: ${rule}`);
  }
}
