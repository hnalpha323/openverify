import { inflateRawSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import { describe, expect, it } from 'vitest';
import { countryName, ofacPrintedDate, ukDate } from './countries.js';
import { element, escapeXmlAttribute, escapeXmlText, renderXml, textElement } from './xml.js';
import { crc32, singleMemberZip, zipArchive } from './zip.js';

/** An independent reader of what the writer must produce (central directory, then local data). */
function readZip(archive: Uint8Array) {
  const view = Buffer.from(archive);
  const end = view.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = view.readUInt16LE(end + 10);
  let offset = view.readUInt32LE(end + 16);
  return Array.from({ length: count }, () => {
    const flags = view.readUInt16LE(offset + 8);
    const method = view.readUInt16LE(offset + 10);
    const crc = view.readUInt32LE(offset + 16);
    const compressed = view.readUInt32LE(offset + 20);
    const size = view.readUInt32LE(offset + 24);
    const nameLength = view.readUInt16LE(offset + 28);
    const extraLength = view.readUInt16LE(offset + 30);
    const commentLength = view.readUInt16LE(offset + 32);
    const local = view.readUInt32LE(offset + 42);
    const name = view.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    expect(view.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + view.readUInt16LE(local + 26) + view.readUInt16LE(local + 28);
    return {
      name,
      flags,
      method,
      crc,
      compressed,
      size,
      raw: view.subarray(start, start + compressed),
    };
  });
}

describe('XML writer', () => {
  it('escapes text and attribute values', () => {
    expect(escapeXmlText('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d "e"');
    expect(escapeXmlAttribute('a & "b" <c>')).toBe('a &amp; &quot;b&quot; &lt;c&gt;');
  });

  it('renders an indented document a strict parser reads back', () => {
    const xml = renderXml(
      element(
        'root',
        { generated: '2026-01-01', count: 2, strong: true, absent: null },
        element(
          'entry',
          { id: 'A&B' },
          textElement('name', 'Q & A <ltd>'),
          textElement('none', null),
        ),
        element('empty'),
        false,
        null,
      ),
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<root ')).toBe(true);
    expect(xml).toContain('generated="2026-01-01" count="2" strong="true"');
    expect(xml).not.toContain('absent');
    expect(xml).toContain(
      '\n  <entry id="A&amp;B">\n    <name>Q &amp; A &lt;ltd&gt;</name>\n  </entry>',
    );
    expect(xml).toContain('\n  <empty/>');
    expect(xml.endsWith('</root>\n')).toBe(true);
    const texts: string[] = [];
    const parser = new SaxesParser();
    parser.on('text', (text) => {
      if (text.trim() !== '') {
        texts.push(text);
      }
    });
    parser.write(xml).close();
    expect(texts).toEqual(['Q & A <ltd>']);
    expect(textElement('n', 3)).toEqual({ name: 'n', attributes: {}, children: ['3'] });
  });
});

describe('ZIP writer', () => {
  const data = new TextEncoder().encode('<sanctionsData>synthetic</sanctionsData>'.repeat(50));

  it('computes the CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes a reproducible single-member archive an independent reader inflates', () => {
    const archive = singleMemberZip('SDN_ENHANCED.XML', data);
    expect(singleMemberZip('SDN_ENHANCED.XML', data)).toEqual(archive);
    const [member, ...rest] = readZip(archive);
    expect(rest).toEqual([]);
    expect(member?.name).toBe('SDN_ENHANCED.XML');
    expect(member?.method).toBe(8);
    expect(member?.flags).toBe(0);
    expect(member?.size).toBe(data.length);
    expect(member?.crc).toBe(crc32(data));
    expect(new Uint8Array(inflateRawSync(member?.raw ?? new Uint8Array()))).toEqual(data);
    const stored = readZip(singleMemberZip('a.xml', data, { method: 'store' }))[0];
    expect(stored?.method).toBe(0);
    expect(new Uint8Array(stored?.raw ?? [])).toEqual(data);
  });

  it('writes the hostile shapes the single-member reader must refuse', () => {
    expect(
      readZip(
        zipArchive([
          { name: 'a.xml', data },
          { name: 'b.xml', data },
        ]),
      ),
    ).toHaveLength(2);
    const lying = readZip(singleMemberZip('a.xml', data, { declaredUncompressedSize: 2 ** 30 }))[0];
    expect(lying?.size).toBe(2 ** 30);
    const descriptor = readZip(singleMemberZip('a.xml', data, { dataDescriptor: true }))[0];
    expect((descriptor?.flags ?? 0) & 0x08).toBe(0x08);
    const encrypted = readZip(singleMemberZip('a.xml', data, { encryptedFlag: true }))[0];
    expect((encrypted?.flags ?? 0) & 0x01).toBe(0x01);
    const small = readZip(singleMemberZip('a.xml', data, { declaredCompressedSize: 10 }))[0];
    expect(small?.compressed).toBe(10);
  });
});

describe('publisher country names and dates', () => {
  it('names countries in English from their codes', () => {
    expect(countryName('GB')).toBe('United Kingdom');
    expect(countryName('FR')).toBe('France');
    expect(() => countryName('gb')).toThrow(RangeError);
  });

  it('prints dates as OFAC and the UK list do', () => {
    expect(ofacPrintedDate('1980-04-12')).toBe('12 Apr 1980');
    expect(ofacPrintedDate('1980-04')).toBe('Apr 1980');
    expect(ofacPrintedDate('1980')).toBe('1980');
    expect(ukDate('1980-04-02')).toBe('02/04/1980');
    expect(ukDate('1980-04')).toBe('dd/04/1980');
    expect(ukDate('1970')).toBe('dd/mm/1970');
  });
});
