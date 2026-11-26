/**
 * C82.1: email domain classes (sandbox names, the disposable list, relays, free mail, custom), the
 * typo suggestion of a custom domain and the MX heuristic. Lists here are synthetic.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyEmailDomain,
  emailTypoSuggestionOf,
  mxOfDisposableService,
  shouldQueryEmailDomainAge,
  withinOneEdit,
} from './domain.js';

const LISTED: ReadonlySet<string> = new Set(['throwaway.example', 'burner.example']);
const production = { disposable: LISTED, environment: 'production' } as const;
const sandbox = { disposable: LISTED, environment: 'sandbox' } as const;

describe('classifyEmailDomain', () => {
  it('reads free mail, relays and custom domains, naming the provider', () => {
    expect(classifyEmailDomain('gmail.com', production)).toEqual({
      kind: 'free_mail',
      provider: { id: 'google', name: 'Gmail', source: 'https://mail.google.com/' },
    });
    expect(classifyEmailDomain('privaterelay.appleid.com', production).kind).toBe('relay');
    expect(classifyEmailDomain('acme-widgets.example', production)).toEqual({
      kind: 'custom',
      provider: null,
    });
  });

  it('reads a listed domain, or a subdomain of one, as disposable', () => {
    expect(classifyEmailDomain('throwaway.example', production)).toEqual({
      kind: 'disposable',
      provider: null,
    });
    expect(classifyEmailDomain('mx.burner.example', production).kind).toBe('disposable');
  });

  it('lets the pinned list decide before the authored tables', () => {
    const listingGmail = { disposable: new Set(['gmail.com']), environment: 'production' } as const;
    expect(classifyEmailDomain('gmail.com', listingGmail).kind).toBe('disposable');
  });

  it('cannot call an unknown domain custom without the list, but knows its own tables', () => {
    const noList = { disposable: null, environment: 'production' } as const;
    expect(classifyEmailDomain('acme-widgets.example', noList)).toEqual({
      kind: null,
      provider: null,
    });
    expect(classifyEmailDomain('gmail.com', noList).kind).toBe('free_mail');
    expect(classifyEmailDomain('duck.com', noList).kind).toBe('relay');
  });

  it('reads the reserved sandbox names in a sandbox only (C82.4)', () => {
    expect(classifyEmailDomain('disposable.example', sandbox).kind).toBe('disposable');
    expect(classifyEmailDomain('shop.disposable.example', sandbox).kind).toBe('disposable');
    expect(classifyEmailDomain('relay.example', sandbox).kind).toBe('relay');
    expect(classifyEmailDomain('disposable.example', production).kind).toBe('custom');
    expect(classifyEmailDomain('relay.example', production).kind).toBe('custom');
  });
});

describe('shouldQueryEmailDomainAge', () => {
  it('asks RDAP for custom and unknown domains only (C85.3: free mail is never asked)', () => {
    expect(shouldQueryEmailDomainAge('custom')).toBe(true);
    expect(shouldQueryEmailDomainAge(null)).toBe(true);
    expect(shouldQueryEmailDomainAge('free_mail')).toBe(false);
    expect(shouldQueryEmailDomainAge('relay')).toBe(false);
    expect(shouldQueryEmailDomainAge('disposable')).toBe(false);
  });
});

describe('withinOneEdit', () => {
  it.each([
    ['gmail.com', 'gmail.com'],
    ['gmail.com', 'gmial.com'],
    ['gmail.com', 'gmai.com'],
    ['gmail.com', 'gmaill.com'],
    ['gmail.com', 'gnail.com'],
    ['ab', 'ba'],
    ['abcd', 'acbd'],
    ['', 'a'],
  ])('reads %s and %s as at most one edit apart', (a, b) => {
    expect(withinOneEdit(a, b)).toBe(true);
    expect(withinOneEdit(b, a)).toBe(true);
  });

  it.each([
    ['gmail.com', 'gmial.co'],
    ['abc', 'cab'],
    ['abcd', 'badc'],
    ['gmail.com', 'gm.com'],
    ['abc', 'xyz'],
  ])('reads %s and %s as two edits or more apart', (a, b) => {
    expect(withinOneEdit(a, b)).toBe(false);
  });
});

describe('emailTypoSuggestionOf', () => {
  it.each([
    ['gmial.com', 'gmail.com'],
    ['gnail.com', 'gmail.com'],
    ['gmail.co', 'gmail.com'],
    ['hotmial.com', 'hotmail.com'],
    ['yahooo.com', 'yahoo.com'],
    ['outlok.com', 'outlook.com'],
    ['icloud.co', 'icloud.com'],
  ])('suggests %s is a typo of %s', (domain, suggestion) => {
    expect(emailTypoSuggestionOf(domain)).toBe(suggestion);
  });

  it('suggests nothing for the domain itself, a domain two edits away, or a short reference', () => {
    expect(emailTypoSuggestionOf('gmail.com')).toBeNull();
    expect(emailTypoSuggestionOf('acme-widgets.example')).toBeNull();
    expect(emailTypoSuggestionOf('gmial.co')).toBeNull();
    // naver.com and aol.com are no typo references: their neighbours are real names.
    expect(emailTypoSuggestionOf('never.com')).toBeNull();
    expect(emailTypoSuggestionOf('aoll.com')).toBeNull();
  });
});

describe('mxOfDisposableService', () => {
  it('reads an exchange of a listed domain, or below one, as a disposable service’s', () => {
    expect(mxOfDisposableService(['mx.throwaway.example'], LISTED)).toBe(true);
    expect(mxOfDisposableService(['', 'in.mx.burner.example.'], LISTED)).toBe(true);
    expect(mxOfDisposableService(['mx.unrelated.example'], LISTED)).toBe(false);
    expect(mxOfDisposableService([], LISTED)).toBe(false);
  });

  it('never reads a known mailbox provider’s exchange as one', () => {
    expect(mxOfDisposableService(['aspmx.l.google.com'], new Set(['google.com']))).toBe(false);
  });
});
