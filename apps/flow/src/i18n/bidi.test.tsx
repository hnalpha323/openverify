import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { isolateValues, useIsolatedT, type IsolatedValues } from './bidi';
import { createI18n } from './create-i18n';
import type { SupportedLanguage } from './languages';

function Paragraph({ message, values }: { message: string; values: IsolatedValues }) {
  return <p data-testid="text">{isolateValues(message, values)}</p>;
}

function Translated({ k, values }: { k: string; values: IsolatedValues }) {
  const tb = useIsolatedT();
  return <p data-testid="text">{tb(k, values)}</p>;
}

function renderTranslated(language: SupportedLanguage, k: string, values: IsolatedValues) {
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Translated k={k} values={values} />
    </I18nextProvider>,
  );
  return screen.getByTestId('text');
}

describe('isolateValues: every interpolated value inside <bdi> (C161.3)', () => {
  it('puts the value in its own <bdi>, the message around it as text', () => {
    render(
      <Paragraph message="We sent a code to {{destination}}." values={{ destination: 'a@b.c' }} />,
    );

    const paragraph = screen.getByTestId('text');
    expect(paragraph).toHaveTextContent(/^We sent a code to a@b\.c\.$/);
    const isolates = paragraph.querySelectorAll('bdi');
    expect([...isolates].map((node) => node.textContent)).toEqual(['a@b.c']);
  });

  it('isolates each placeholder, repeated or spaced, and numbers as written', () => {
    render(
      <Paragraph message="{{ current }} / {{max}}: {{current}}" values={{ current: 2, max: 10 }} />,
    );

    const paragraph = screen.getByTestId('text');
    expect(paragraph).toHaveTextContent('2 / 10: 2');
    expect([...paragraph.querySelectorAll('bdi')].map((node) => node.textContent)).toEqual([
      '2',
      '10',
      '2',
    ]);
  });

  it('renders a value as text, never as markup', () => {
    render(<Paragraph message="Hi {{name}}" values={{ name: '<b>x</b>' }} />);

    const paragraph = screen.getByTestId('text');
    expect(paragraph.querySelector('b')).toBeNull();
    expect(paragraph.querySelector('bdi')).toHaveTextContent('<b>x</b>');
  });

  it('leaves a placeholder without a value as written, so the gap is visible', () => {
    render(<Paragraph message="Sent to {{destination}}." values={{}} />);

    const paragraph = screen.getByTestId('text');
    expect(paragraph).toHaveTextContent('Sent to {{destination}}.');
    expect(paragraph.querySelector('bdi')).toBeNull();
  });

  it('returns the message alone when it has no placeholder', () => {
    expect(isolateValues('Continue', { name: 'x' })).toEqual(['Continue']);
  });
});

describe('useIsolatedT: a catalog message with its values isolated', () => {
  it('translates and isolates in the current language', () => {
    const paragraph = renderTranslated('en', 'otp.code.sentTo', { destination: '+1 202 555 0143' });

    expect(paragraph).toHaveTextContent('We sent a code to +1 202 555 0143.');
    expect(paragraph.querySelector('bdi')).toHaveTextContent('+1 202 555 0143');
  });

  it('chooses the plural form by count, in Arabic too', () => {
    const english = renderTranslated('en', 'document.pages', { count: 3 });
    expect(english).toHaveTextContent('A PDF can have up to 3 pages.');
    expect(english.querySelector('bdi')).toHaveTextContent('3');
  });

  it('isolates a Latin value inside Arabic text', () => {
    const arabic = renderTranslated('ar', 'otp.code.sentTo', { destination: 'name@example.com' });

    expect(arabic.textContent).not.toContain('We sent');
    expect(arabic.textContent).toMatch(/[؀-ۿ]/);
    expect(arabic.querySelector('bdi')).toHaveTextContent('name@example.com');
  });
});
