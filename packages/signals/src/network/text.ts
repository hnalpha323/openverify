/**
 * Strict text helpers for the publication parsers (C92.2 step 5): UTF-8 only, lines, RFC 4180
 * fields and the timestamps each publisher writes. Every refusal names a position, never a value.
 */
import { NetworkParseError } from './errors.js';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
/** Printable ASCII, the form of every publisher label this package keeps. */
const LABEL = /^[\x20-\x7e]+$/;
const SPACE_TIME = /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})$/;
const ISO_TIME =
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})?$/;

/**
 * The text of a publication: strict UTF-8, a leading byte-order mark dropped.
 * @throws {NetworkParseError} `encoding` when the bytes are not UTF-8.
 */
export function decodeText(bytes: Uint8Array | string): string {
  let text: string;
  if (typeof bytes === 'string') {
    text = bytes;
  } else {
    try {
      text = UTF8.decode(bytes);
    } catch (error) {
      throw new NetworkParseError('encoding', 'the publication is not UTF-8', { cause: error });
    }
  }
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/**
 * A publication's JSON value.
 * @throws {NetworkParseError} `encoding` or `malformed`.
 */
export function readJson(bytes: Uint8Array | string): unknown {
  const text = decodeText(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new NetworkParseError('malformed', 'the publication is not well-formed JSON', {
      cause: error,
    });
  }
}

/** The lines of a text, without their `\n` or `\r\n` ends. */
export function splitLines(text: string): string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * The fields of one RFC 4180 record on one line: a quoted field may hold commas and doubled
 * quotes; an unquoted field may hold no quote.
 * @throws {NetworkParseError} `format` for an open quote or a quote in an unquoted field.
 */
export function csvFields(line: string, where: string): string[] {
  const fields: string[] = [];
  let index = 0;
  for (;;) {
    let field = '';
    if (line[index] === '"') {
      index += 1;
      for (;;) {
        const quote = line.indexOf('"', index);
        if (quote < 0) {
          throw new NetworkParseError('format', `${where}: an open quote`);
        }
        field += line.slice(index, quote);
        if (line[quote + 1] === '"') {
          field += '"';
          index = quote + 2;
          continue;
        }
        index = quote + 1;
        break;
      }
      if (index < line.length && line[index] !== ',') {
        throw new NetworkParseError('format', `${where}: text after a closing quote`);
      }
    } else {
      const comma = line.indexOf(',', index);
      field = comma < 0 ? line.slice(index) : line.slice(index, comma);
      if (field.includes('"')) {
        throw new NetworkParseError('format', `${where}: a quote inside an unquoted field`);
      }
      index = comma < 0 ? line.length : comma;
    }
    fields.push(field);
    if (index >= line.length) {
      return fields;
    }
    index += 1;
  }
}

function utcDate(
  parts: readonly string[],
  where: string,
  milliseconds = 0,
  offsetMinutes = 0,
): Date {
  const [year, month, day, hour, minute, second] = parts.map((part) =>
    Number.parseInt(part, 10),
  ) as [number, number, number, number, number, number];
  const at = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const check = new Date(at);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    throw new NetworkParseError('time', `${where}: not a real instant`);
  }
  return new Date(at - offsetMinutes * 60_000);
}

/**
 * `YYYY-MM-DD HH:MM:SS` in UTC (TorDNSEL, geofeed stamps).
 * @throws {NetworkParseError} `time`.
 */
export function spaceSeparatedUtc(text: string, where: string): Date {
  const match = SPACE_TIME.exec(text);
  if (match === null) {
    throw new NetworkParseError('time', `${where}: not YYYY-MM-DD HH:MM:SS`);
  }
  return utcDate(match.slice(1, 7), where);
}

/**
 * ISO 8601 `YYYY-MM-DDTHH:MM:SS[.fraction][Z|+HH:MM]`; no zone means UTC (Oracle).
 * @throws {NetworkParseError} `time`.
 */
export function isoUtc(text: string, where: string): Date {
  const match = ISO_TIME.exec(text);
  if (match === null) {
    throw new NetworkParseError('time', `${where}: not an ISO 8601 time`);
  }
  const fraction = match[7] ?? '';
  const milliseconds = Number.parseInt(fraction.padEnd(3, '0').slice(0, 3), 10);
  const zone = match[8] ?? 'Z';
  const offset =
    zone === 'Z'
      ? 0
      : (zone.startsWith('-') ? -1 : 1) *
        (Number.parseInt(zone.slice(1, 3), 10) * 60 + Number.parseInt(zone.slice(4, 6), 10));
  return utcDate(match.slice(1, 7), where, milliseconds, offset);
}

/**
 * A Unix time written as decimal digits (`syncToken`).
 * @throws {NetworkParseError} `time`.
 */
export function epochTime(text: string, unit: 'seconds' | 'milliseconds', where: string): Date {
  if (!/^[0-9]{1,16}$/.test(text)) {
    throw new NetworkParseError('time', `${where}: not a Unix time`);
  }
  const value = Number.parseInt(text, 10) * (unit === 'seconds' ? 1000 : 1);
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw new NetworkParseError('time', `${where}: out of range`);
  }
  return at;
}

/**
 * A publisher label: printable ASCII, 1 to `max` characters.
 * @throws {NetworkParseError} `format`.
 */
export function label(value: unknown, where: string, max = 64): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !LABEL.test(value)) {
    throw new NetworkParseError(
      'format',
      `${where}: not a label of 1 to ${String(max)} printable characters`,
    );
  }
  return value;
}

/** A plain object, or a `format` refusal. */
export function objectAt(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NetworkParseError('format', `${where}: not an object`);
  }
  return value as Record<string, unknown>;
}

/** An array, or a `format` refusal. */
export function arrayAt(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new NetworkParseError('format', `${where}: not an array`);
  }
  return value;
}

/** A string, or a `format` refusal. */
export function stringAt(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    throw new NetworkParseError('format', `${where}: not a string`);
  }
  return value;
}
