/**
 * C78.2: token scripts, the original-script form, ICAO 9303 Part 3 §6.B and §6.C, and the lossy
 * any-ascii forms. Every name here is a common given or family name, never a listed person.
 */
import { describe, expect, it } from 'vitest';
import {
  ICAO_ARABIC_TRANSLITERATIONS,
  ICAO_CYRILLIC_TRANSLITERATIONS,
  icaoArabicMrz,
  latinForm,
  lossyLatin,
  normaliseOriginal,
  tokenScript,
  transliterateArabic,
  transliterateCyrillic,
} from './index.js';

describe('tokenScript', () => {
  it.each([
    ['Müller', 'latin'],
    ['Иван', 'cyrillic'],
    ['محمد', 'arabic'],
    ['דוד', 'hebrew'],
    ['王小明', 'han'],
    ['김', 'hangul'],
    ['ゆうき', 'hiragana'],
    ['Παπαδόπουλος', 'greek'],
  ] as const)('reads %s as %s', (token, script) => {
    expect(tokenScript(token)).toBe(script);
  });

  it('ignores letters of the Common script, such as the prolonged-sound mark of kana', () => {
    expect(tokenScript('カール')).toBe('katakana');
  });

  it('answers other for a script C58 does not name, mixed for two, and null without letters', () => {
    expect(tokenScript('ꦗꦮ')).toBe('other');
    expect(tokenScript('Ivаn')).toBe('mixed');
    expect(tokenScript('1980')).toBeNull();
    expect(tokenScript('')).toBeNull();
  });
});

describe('normaliseOriginal', () => {
  it('drops Arabic vowel marks and tatweel and unifies alef, yeh, kaf and teh marbuta', () => {
    expect(normaliseOriginal('مُحَمَّد')).toBe('محمد');
    expect(normaliseOriginal('محـمد')).toBe('محمد');
    expect(normaliseOriginal('أحمد')).toBe(normaliseOriginal('احمد'));
    expect(normaliseOriginal('إبراهيم')).toBe(normaliseOriginal('ابراهيم'));
    expect(normaliseOriginal('مصطفى')).toBe(normaliseOriginal('مصطفي'));
    expect(normaliseOriginal('علی')).toBe(normaliseOriginal('علي'));
    expect(normaliseOriginal('فاطمة')).toBe(normaliseOriginal('فاطمه'));
  });

  it('drops Hebrew points, Greek accents and final sigma, and reads Cyrillic ё as е', () => {
    expect(normaliseOriginal('דָּוִד')).toBe('דוד');
    expect(normaliseOriginal('Παπαδόπουλος')).toBe('παπαδοπουλοσ');
    expect(normaliseOriginal('Фёдор')).toBe('федор');
  });

  it('lower-cases and folds compatibility forms, and keeps the marks other scripts spell with', () => {
    expect(normaliseOriginal('ＡＢＣ')).toBe('abc');
    expect(normaliseOriginal('Иван')).toBe('иван');
    expect(normaliseOriginal('राहुल')).toBe('राहुल');
  });
});

describe('ICAO 9303 §6.B (Cyrillic)', () => {
  it('lists the 48 rows of the base column, and Ь as omitted, in plain lower-case Latin', () => {
    expect(Object.keys(ICAO_CYRILLIC_TRANSLITERATIONS)).toHaveLength(49);
    for (const [letter, latin] of Object.entries(ICAO_CYRILLIC_TRANSLITERATIONS)) {
      expect(letter).toBe(letter.toUpperCase());
      expect(latin).toMatch(/^[a-z]*$/);
    }
    expect(ICAO_CYRILLIC_TRANSLITERATIONS['Ь']).toBe('');
  });

  it.each([
    ['Щербаков', 'shcherbakov'],
    ['Юлия', 'iuliia'],
    ['Ксения', 'kseniia'],
    ['Ольга', 'olga'],
    ['Объедков', 'obieedkov'],
    ['Хрущёв', 'khrushchev'],
    ['Цветаева', 'tsvetaeva'],
    ['Жуков', 'zhukov'],
    ['Йордан', 'iordan'],
    ['Ґалаґан', 'galagan'],
    ['Љубица', 'ljubitsa'],
  ])('writes %s as %s, reliably', (cyrillic, latin) => {
    expect(transliterateCyrillic(cyrillic)).toEqual({ latin, reliable: true });
  });

  it('passes other characters through, and a letter the table does not list makes it lossy', () => {
    expect(transliterateCyrillic('ab-12')).toEqual({ latin: 'ab-12', reliable: true });
    const unlisted = transliterateCyrillic('Ћирић');
    expect(unlisted.reliable).toBe(false);
    expect(unlisted.latin).toBe('ciric');
  });
});

describe('ICAO 9303 §6.C (Arabic)', () => {
  it('writes the MRZ form with its X escapes, shadda doubling and final teh marbuta', () => {
    expect(icaoArabicMrz('محمد')).toBe('MXHMD');
    // Part 3 §6.C, notes 2 and 3: a shadda doubles; a final teh marbuta is XAH.
    expect(icaoArabicMrz('عبّاس')).toBe('EBBAS');
    expect(icaoArabicMrz('فضّة')).toBe('FXDZXDZXAH');
    expect(icaoArabicMrz('مُحَمَّد')).toBe('MXHMMD');
    expect(icaoArabicMrz('ةب')).toBe('XTAB');
  });

  it('lists each row with an MRZ code of capitals and a plain Latin reading', () => {
    expect(ICAO_ARABIC_TRANSLITERATIONS.size).toBe(79);
    for (const { mrz, latin } of ICAO_ARABIC_TRANSLITERATIONS.values()) {
      expect(mrz).toMatch(/^[A-Z]*$/);
      expect(latin).toMatch(/^[a-z]*$/);
    }
    expect(ICAO_ARABIC_TRANSLITERATIONS.get(0x062b)).toEqual({ mrz: 'XTH', latin: 'th' });
    expect(ICAO_ARABIC_TRANSLITERATIONS.get(0x064e)).toEqual({ mrz: '', latin: '' });
  });

  it.each([
    ['محمد', 'mhmd'],
    ['عبد', 'abd'],
    ['خالد', 'khald'],
    ['فاطمة', 'fatma'],
    ['عبّاس', 'abbas'],
    ['پرویز', 'prwyz'],
  ])('reads %s as %s, never reliably', (arabic, latin) => {
    expect(transliterateArabic(arabic)).toEqual({ latin, reliable: false });
  });
});

describe('lossyLatin (any-ascii)', () => {
  it('romanises any script to lower-case letters and digits', () => {
    expect(lossyLatin('王小明')).toBe('wangxiaoming');
    expect(lossyLatin('Παπαδόπουλος')).toBe('papadopoylos');
    expect(lossyLatin('김')).toBe('gim');
    expect(lossyLatin('!!!')).toBe('');
  });
});

describe('latinForm', () => {
  it('folds a Latin token in both renderings (ICAO 9303 §6.A for the expanded one)', () => {
    expect(latinForm('Müller', 'latin')).toEqual({
      simple: 'muller',
      expanded: 'mueller',
      reliability: 'native',
    });
    expect(latinForm('1980', null)).toEqual({
      simple: '1980',
      expanded: '1980',
      reliability: 'native',
    });
  });

  it('transliterates Cyrillic reliably, and Arabic and every other script lossily', () => {
    expect(latinForm('Щербаков', 'cyrillic')).toEqual({
      simple: 'shcherbakov',
      expanded: 'shcherbakov',
      reliability: 'icao',
    });
    expect(latinForm('Ћирић', 'cyrillic').reliability).toBe('lossy');
    expect(latinForm('محمد', 'arabic')).toEqual({
      simple: 'mhmd',
      expanded: 'mhmd',
      reliability: 'lossy',
    });
    expect(latinForm('王小明', 'han')).toEqual({
      simple: 'wangxiaoming',
      expanded: 'wangxiaoming',
      reliability: 'lossy',
    });
    expect(latinForm('Ivаn', 'mixed')).toEqual({
      simple: 'ivan',
      expanded: 'ivan',
      reliability: 'lossy',
    });
  });

  it('answers none when nothing Latin can be made of the token', () => {
    expect(latinForm(String.fromCodePoint(0x9fb3), 'han')).toEqual({
      simple: '',
      expanded: '',
      reliability: 'none',
    });
  });
});
