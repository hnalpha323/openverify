/**
 * C148.2 (Workflow 9A, flow-renderer): the component catalogue v1 as the web flow renders it, one
 * entry per kind in `SCREEN_COMPONENTS`, which the screen step and the preview (C156.3) both use.
 * Built in, whatever the operator configures (C148.7, WCAG 2.2): a visible label from the copy
 * key; errors linked by `aria-describedby`; `autocomplete` tokens by purpose; targets of at least
 * 24 CSS px; operator text as React text with `white-space: pre-line`, never markup (C162.3).
 */
import type { ComponentKind } from '@openverify/flow-spec';
import { cx } from '@openverify/ui';
import { createContext, use, useContext, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FlowLinksContext } from '../components/flow-links';
import { RequiredMark } from '../components/form-field';
import { useIntlLocale } from '../session/use-intl-locale';
import { countryOptions } from '../steps/forms/regions';
import {
  ADDRESS_PARTS,
  type AddressComponent,
  type BoundField,
  type ButtonComponent,
  type FieldError,
  type FormComponent,
  type ScreenValue,
  type Visibility,
} from './screen-model';
import type { Component } from '@openverify/flow-spec';

/** What every component of a screen reads: the form's state, its copy and its actions. */
export interface ScreenContextValue {
  readonly values: Readonly<Record<string, ScreenValue>>;
  readonly set: ReadonlySet<string>;
  /** Errors shown (after a submit), by field key. */
  readonly errors: ReadonlyMap<string, FieldError>;
  readonly visibility: ReadonlyMap<string, Visibility>;
  readonly busy: boolean;
  /** A component's operator text (C162.6), or `null` when no catalog holds it. */
  readonly copy: (key: string) => string | null;
  /**
   * WCAG 3.1.2 (Workflow 9D): the language of a key's text when C162.5's fallback took it from
   * another locale than the page's, else `null`; the element showing it carries it as `lang`.
   */
  readonly copyLanguage: (key: string) => string | null;
  readonly change: (field: BoundField, value: ScreenValue) => void;
  /** `cancel` buttons ask first (C148.2). */
  readonly cancel: () => void;
  /**
   * The version's `https:` links (C162.3); a link button with none is not shown. Without one here
   * (the live flow), the button names the session's link the layout knows (`FlowLinksContext`).
   */
  readonly links: Readonly<Partial<Record<'help-url' | 'privacy-url', string>>>;
  /** A theme asset as a `blob:` URL once loaded (C160.6), or `null`. */
  readonly asset: (assetId: string) => string | null;
  /** The id of a field's control, so the error summary can link to it. */
  readonly controlId: (field: string) => string;
}

export const ScreenContext = createContext<ScreenContextValue | null>(null);

function useScreen(): ScreenContextValue {
  const screen = useContext(ScreenContext);
  if (screen === null) {
    throw new Error('A screen component renders inside ScreenContext');
  }
  return screen;
}

/** Plain operator text, line breaks kept (C162.3). */
function Text({
  children,
  lang = null,
}: {
  readonly children: ReactNode;
  /** WCAG 3.1.2: the text's language when it differs from the page's. */
  readonly lang?: string | null;
}) {
  return (
    <span lang={lang ?? undefined} className="whitespace-pre-line">
      {children}
    </span>
  );
}

/** The control classes every text-like field shares; `min-h-11` keeps a 44 px target (2.5.8). */
const CONTROL =
  'min-h-11 w-full rounded-md border bg-surface px-3 py-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';

/** A 24 CSS px box or radio (2.5.8), its label beside it as part of the target. */
const CHOICE =
  'mt-0.5 size-6 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed';

/** The message of a field's error, with its bound in the person's digits. */
function useErrorText(): (error: FieldError) => string {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  return (error) => {
    if (error.limit === undefined) return t(`screen.errors.${error.code}`, { limit: '' });
    const number = Number(error.limit);
    const limit = Number.isFinite(number)
      ? new Intl.NumberFormat(intlTag).format(number)
      : error.limit;
    return t(`screen.errors.${error.code}`, { limit });
  };
}

interface FieldFrameProps {
  readonly field: string;
  readonly label: string;
  readonly hint: string | null;
  readonly labelLang: string | null;
  readonly hintLang: string | null;
  readonly required: boolean;
  readonly children: (described: string | undefined, invalid: boolean) => ReactNode;
}

/** A label, the hint, the control and its error, wired for assistive technology (C148.7). */
function FieldFrame({
  field,
  label,
  hint,
  labelLang,
  hintLang,
  required,
  children,
}: FieldFrameProps) {
  const screen = useScreen();
  const errorText = useErrorText();
  const { t } = useTranslation();
  const id = useId();
  const error = screen.errors.get(field);
  const hintId = hint === null ? undefined : `${id}-hint`;
  const setId = screen.set.has(field) ? `${id}-set` : undefined;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const described = [hintId, setId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5" data-field={field}>
      <div className="flex items-baseline gap-1">
        <label htmlFor={screen.controlId(field)} className="text-sm font-medium text-ink">
          <Text lang={labelLang}>{label}</Text>
        </label>
        {required && <RequiredMark />}
      </div>
      {hintId !== undefined && (
        <p id={hintId} className="text-sm text-ink-muted">
          <Text lang={hintLang}>{hint}</Text>
        </p>
      )}
      {setId !== undefined && (
        <p id={setId} className="text-sm text-ink-muted">
          {t('screen.set')}
        </p>
      )}
      {children(described, error !== undefined)}
      {errorId !== undefined && error !== undefined && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}

/** A form component's label and hint from its copy keys. */
function useLabels(component: {
  readonly labelKey: string;
  readonly hintKey?: string | undefined;
}) {
  const screen = useScreen();
  return {
    label: screen.copy(component.labelKey) ?? '',
    hint: component.hintKey === undefined ? null : screen.copy(component.hintKey),
    labelLang: screen.copyLanguage(component.labelKey),
    hintLang: component.hintKey === undefined ? null : screen.copyLanguage(component.hintKey),
  };
}

/** `type`, `inputMode` and `autocomplete` by kind (C148.7, WCAG 1.3.5). */
function inputAttributes(component: FormComponent): {
  readonly type: string;
  readonly inputMode?: 'numeric' | 'decimal' | 'tel' | 'email' | 'url';
  readonly autoComplete: string;
} {
  switch (component.kind) {
    case 'email':
      return { type: 'email', inputMode: 'email', autoComplete: 'email' };
    case 'phone':
      return { type: 'tel', inputMode: 'tel', autoComplete: 'tel' };
    case 'url':
      return { type: 'url', inputMode: 'url', autoComplete: 'url' };
    case 'number':
      // A text input, so typed Arabic-Indic digits reach the normalisation (C161.4).
      return { type: 'text', inputMode: 'decimal', autoComplete: 'off' };
    case 'date':
      return {
        type: 'date',
        autoComplete: /birth|dob/u.test(component.field) ? 'bday' : 'off',
      };
    case 'masked_text':
      return { type: 'password', autoComplete: 'off' };
    default:
      return { type: 'text', autoComplete: 'off' };
  }
}

/** A single-line field: text, number, date, email, phone, URL or masked text. */
function InputComponent({
  component,
  state,
}: {
  readonly component: FormComponent;
  readonly state: Visibility;
}) {
  const screen = useScreen();
  const { label, hint, labelLang, hintLang } = useLabels(component);
  const value = screen.values[component.field];
  const { type, inputMode, autoComplete } = inputAttributes(component);
  const field: BoundField = { key: component.field, component };

  return (
    <FieldFrame
      field={component.field}
      label={label}
      hint={hint}
      labelLang={labelLang}
      hintLang={hintLang}
      required={component.required === true}
    >
      {(described, invalid) => (
        <input
          id={screen.controlId(component.field)}
          name={component.field}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          required={component.required === true && !screen.set.has(component.field)}
          disabled={state === 'disabled' || screen.busy}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={described}
          dir={type === 'text' || component.kind === 'masked_text' ? undefined : 'ltr'}
          className={cx(CONTROL, invalid ? 'border-danger' : 'border-control')}
          onChange={(event) => {
            screen.change(field, event.currentTarget.value);
          }}
        />
      )}
    </FieldFrame>
  );
}

function TextAreaComponent({
  component,
  state,
}: {
  readonly component: Extract<FormComponent, { kind: 'text_area' }>;
  readonly state: Visibility;
}) {
  const screen = useScreen();
  const { label, hint, labelLang, hintLang } = useLabels(component);
  const value = screen.values[component.field];

  return (
    <FieldFrame
      field={component.field}
      label={label}
      hint={hint}
      labelLang={labelLang}
      hintLang={hintLang}
      required={component.required === true}
    >
      {(described, invalid) => (
        <textarea
          id={screen.controlId(component.field)}
          name={component.field}
          rows={4}
          required={component.required === true && !screen.set.has(component.field)}
          disabled={state === 'disabled' || screen.busy}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={described}
          className={cx(CONTROL, invalid ? 'border-danger' : 'border-control')}
          onChange={(event) => {
            screen.change({ key: component.field, component }, event.currentTarget.value);
          }}
        />
      )}
    </FieldFrame>
  );
}

function SelectComponent({
  component,
  state,
}: {
  readonly component: Extract<FormComponent, { kind: 'select' | 'country_select' }>;
  readonly state: Visibility;
}) {
  const screen = useScreen();
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  const { label, hint, labelLang, hintLang } = useLabels(component);
  const value = screen.values[component.field];
  const options =
    component.kind === 'select'
      ? component.options.map((option) => ({
          value: option.value,
          label: screen.copy(option.labelKey) ?? option.value,
          lang: screen.copyLanguage(option.labelKey),
        }))
      : countryOptions(intlTag)
          .filter(
            (option) =>
              component.allowedCountries === undefined ||
              component.allowedCountries.includes(option.value),
          )
          .map(({ value: code, label: name }) => ({ value: code, label: name, lang: null }));

  return (
    <FieldFrame
      field={component.field}
      label={label}
      hint={hint}
      labelLang={labelLang}
      hintLang={hintLang}
      required={component.required === true}
    >
      {(described, invalid) => (
        <select
          id={screen.controlId(component.field)}
          name={component.field}
          autoComplete={component.kind === 'country_select' ? 'country' : 'off'}
          required={component.required === true}
          disabled={state === 'disabled' || screen.busy}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={described}
          className={cx(CONTROL, invalid ? 'border-danger' : 'border-control')}
          onChange={(event) => {
            screen.change({ key: component.field, component }, event.currentTarget.value);
          }}
        >
          <option value="">{t('screen.choose')}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value} lang={option.lang ?? undefined}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

/** A group of radios or checkboxes in a fieldset, its legend the label (1.3.1). */
function ChoiceGroup({
  component,
  state,
  multiple,
}: {
  readonly component: Extract<
    FormComponent,
    { kind: 'radio_group' | 'checkbox_group' | 'multi_select' }
  >;
  readonly state: Visibility;
  readonly multiple: boolean;
}) {
  const screen = useScreen();
  const errorText = useErrorText();
  const { label, hint, labelLang, hintLang } = useLabels(component);
  const id = useId();
  const value = screen.values[component.field];
  const chosen: readonly string[] =
    typeof value === 'string'
      ? [value]
      : typeof value === 'boolean' || value === undefined
        ? []
        : value;
  const error = screen.errors.get(component.field);
  const hintId = hint === null ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const described = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset
      className="flex flex-col gap-2"
      data-field={component.field}
      aria-describedby={described}
      aria-invalid={error === undefined ? undefined : true}
      disabled={state === 'disabled' || screen.busy}
    >
      <legend className="flex items-baseline gap-1 text-sm font-medium text-ink">
        <Text lang={labelLang}>{label}</Text>
        {component.required === true && <RequiredMark />}
      </legend>
      {hintId !== undefined && (
        <p id={hintId} className="text-sm text-ink-muted">
          <Text lang={hintLang}>{hint}</Text>
        </p>
      )}
      {component.options.map((option, index) => {
        const optionId = index === 0 ? screen.controlId(component.field) : `${id}-${option.key}`;
        return (
          <div key={option.key} className="flex min-h-6 items-start gap-3">
            <input
              id={optionId}
              type={multiple ? 'checkbox' : 'radio'}
              name={component.field}
              value={option.value}
              checked={chosen.includes(option.value)}
              className={CHOICE}
              onChange={(event) => {
                const { checked } = event.currentTarget;
                const next = multiple
                  ? checked
                    ? [...chosen, option.value]
                    : chosen.filter((item) => item !== option.value)
                  : option.value;
                screen.change({ key: component.field, component }, next);
              }}
            />
            <label htmlFor={optionId} className="text-sm text-ink">
              <Text lang={screen.copyLanguage(option.labelKey)}>
                {screen.copy(option.labelKey) ?? option.value}
              </Text>
            </label>
          </div>
        );
      })}
      {errorId !== undefined && error !== undefined && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {errorText(error)}
        </p>
      )}
    </fieldset>
  );
}

function CheckboxComponent({
  component,
  state,
}: {
  readonly component: Extract<FormComponent, { kind: 'checkbox' }>;
  readonly state: Visibility;
}) {
  const screen = useScreen();
  const errorText = useErrorText();
  const { label, hint, labelLang, hintLang } = useLabels(component);
  const id = useId();
  const error = screen.errors.get(component.field);
  const hintId = hint === null ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const described = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const controlId = screen.controlId(component.field);

  return (
    <div className="flex flex-col gap-1" data-field={component.field}>
      <div className="flex min-h-6 items-start gap-3">
        <input
          id={controlId}
          type="checkbox"
          name={component.field}
          required={component.required === true}
          disabled={state === 'disabled' || screen.busy}
          checked={screen.values[component.field] === true}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={described}
          className={CHOICE}
          onChange={(event) => {
            screen.change({ key: component.field, component }, event.currentTarget.checked);
          }}
        />
        <label htmlFor={controlId} className="flex items-baseline gap-1 text-sm text-ink">
          <Text lang={labelLang}>{label}</Text>
          {component.required === true && <RequiredMark />}
        </label>
      </div>
      {hintId !== undefined && (
        <p id={hintId} className="ps-9 text-sm text-ink-muted">
          <Text lang={hintLang}>{hint}</Text>
        </p>
      )}
      {errorId !== undefined && error !== undefined && (
        <p id={errorId} className="ps-9 text-sm font-medium text-danger">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}

/** The `autocomplete` token of each address part (WCAG 1.3.5). */
const ADDRESS_AUTOCOMPLETE = {
  street1: 'address-line1',
  street2: 'address-line2',
  city: 'address-level2',
  subdivision: 'address-level1',
  postalCode: 'postal-code',
  country: 'country',
} as const;

function AddressComponentView({
  component,
  state,
}: {
  readonly component: AddressComponent;
  readonly state: Visibility;
}) {
  const screen = useScreen();
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  const errorText = useErrorText();
  const id = useId();
  const label = screen.copy(component.labelKey) ?? '';
  const hint = component.hintKey === undefined ? null : screen.copy(component.hintKey);
  const labelLang = screen.copyLanguage(component.labelKey);
  const hintLang = component.hintKey === undefined ? null : screen.copyLanguage(component.hintKey);
  const hintId = hint === null ? undefined : `${id}-hint`;

  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-describedby={hintId}
      disabled={state === 'disabled' || screen.busy}
    >
      <legend className="text-sm font-medium text-ink">
        <Text lang={labelLang}>{label}</Text>
      </legend>
      {hintId !== undefined && (
        <p id={hintId} className="text-sm text-ink-muted">
          <Text lang={hintLang}>{hint}</Text>
        </p>
      )}
      {ADDRESS_PARTS.map((part) => {
        const key = component.fields[part];
        if (key === undefined) return null;
        const field: BoundField = { key, component, part };
        const value = screen.values[key];
        const error = screen.errors.get(key);
        const errorId = error === undefined ? undefined : `${id}-${part}-error`;
        const required =
          component.required === true && part !== 'street2' && part !== 'subdivision';
        const common = {
          id: screen.controlId(key),
          name: key,
          autoComplete: ADDRESS_AUTOCOMPLETE[part],
          required,
          value: typeof value === 'string' ? value : '',
          'aria-invalid': error === undefined ? undefined : true,
          'aria-describedby': errorId,
          className: cx(CONTROL, error === undefined ? 'border-control' : 'border-danger'),
        } as const;
        return (
          <div key={part} className="flex flex-col gap-1.5" data-field={key}>
            <div className="flex items-baseline gap-1">
              <label htmlFor={common.id} className="text-sm font-medium text-ink">
                {t(`screen.address.${part}`)}
              </label>
              {required && <RequiredMark />}
            </div>
            {part === 'country' ? (
              <select
                {...common}
                onChange={(event) => {
                  screen.change(field, event.currentTarget.value);
                }}
              >
                <option value="">{t('screen.choose')}</option>
                {countryOptions(intlTag)
                  .filter(
                    (option) =>
                      component.allowedCountries === undefined ||
                      component.allowedCountries.includes(option.value),
                  )
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            ) : (
              <input
                {...common}
                type="text"
                onChange={(event) => {
                  screen.change(field, event.currentTarget.value);
                }}
              />
            )}
            {errorId !== undefined && error !== undefined && (
              <p id={errorId} className="text-sm font-medium text-danger">
                {errorText(error)}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

function ButtonView({
  component,
  state,
}: {
  readonly component: ButtonComponent;
  readonly state: Visibility;
}) {
  const screen = useScreen();
  const sessionLinks = use(FlowLinksContext);
  const label = (
    <Text lang={screen.copyLanguage(component.labelKey)}>
      {screen.copy(component.labelKey) ?? ''}
    </Text>
  );
  const classes =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';
  switch (component.action) {
    case 'submit':
      return (
        <button
          type="submit"
          name="button"
          value={component.port ?? ''}
          disabled={state === 'disabled' || screen.busy}
          className={cx(classes, 'bg-primary text-on-primary enabled:hover:bg-primary-hover')}
        >
          {label}
        </button>
      );
    case 'cancel':
      return (
        <button
          type="button"
          disabled={state === 'disabled' || screen.busy}
          className={cx(classes, 'border border-line bg-surface text-ink enabled:hover:bg-canvas')}
          onClick={screen.cancel}
        >
          {label}
        </button>
      );
    case 'link': {
      const url =
        component.link === undefined
          ? undefined
          : (screen.links[component.link] ?? sessionLinks[component.link]);
      if (url === undefined) return null;
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {label}
        </a>
      );
    }
  }
}

/** The props of one entry of the catalogue. */
export interface ScreenComponentProps<Kind extends ComponentKind = ComponentKind> {
  readonly component: Extract<Component, { kind: Kind }>;
  readonly state: Visibility;
  /** The screen's first `title` text is its `h1`, the others `h2`. */
  readonly headingLevel: 1 | 2;
  readonly renderChildren: (children: readonly Component[]) => ReactNode;
}

type Registry = {
  readonly [Kind in ComponentKind]: (props: ScreenComponentProps<Kind>) => ReactNode;
};

/** C148.2: how each kind of component renders; the preview renders screens with the same entries. */
export const SCREEN_COMPONENTS: Registry = {
  text: function TextView({ component, headingLevel }) {
    const screen = useScreen();
    const text = (
      <Text lang={screen.copyLanguage(component.copyKey)}>
        {screen.copy(component.copyKey) ?? ''}
      </Text>
    );
    switch (component.variant) {
      case 'title': {
        const Heading = headingLevel === 1 ? 'h1' : 'h2';
        return <Heading className="text-xl font-semibold text-ink">{text}</Heading>;
      }
      case 'body':
        return <p className="text-ink">{text}</p>;
      case 'caption':
        return <p className="text-sm text-ink-muted">{text}</p>;
    }
  },
  image: function ImageView({ component }) {
    const screen = useScreen();
    const src = screen.asset(component.assetId);
    const alt = component.decorative ? '' : (screen.copy(component.altKey ?? '') ?? '');
    const lang = component.decorative
      ? undefined
      : (screen.copyLanguage(component.altKey ?? '') ?? undefined);
    if (src === null) {
      // Not loaded (or no asset route yet): the text alternative stands in, never a broken image.
      return component.decorative ? null : (
        <p lang={lang} className="text-sm text-ink-muted">
          {alt}
        </p>
      );
    }
    return <img src={src} alt={alt} lang={lang} className="max-h-48 max-w-full object-contain" />;
  },
  spacer: function SpacerView({ component }) {
    const height = { s: 'h-2', m: 'h-4', l: 'h-8' }[component.size];
    return <div aria-hidden="true" className={height} />;
  },
  stepper: function StepperView({ component }) {
    const screen = useScreen();
    return (
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
        {component.labelKeys.map((key, index) => (
          <li
            key={key}
            aria-current={index === component.current ? 'step' : undefined}
            className={index === component.current ? 'font-semibold text-ink' : undefined}
          >
            <Text lang={screen.copyLanguage(key)}>{screen.copy(key) ?? ''}</Text>
          </li>
        ))}
      </ol>
    );
  },
  container: function ContainerView({ component, renderChildren }) {
    return (
      <div
        className={cx(
          'flex gap-4',
          component.direction === 'horizontal' ? 'flex-row flex-wrap items-end' : 'flex-col',
        )}
      >
        {renderChildren(component.children)}
      </div>
    );
  },
  footer: function FooterView({ component, renderChildren }) {
    return (
      <div className="flex flex-col gap-4 border-t border-line pt-4">
        {renderChildren(component.children)}
      </div>
    );
  },
  text_input: (props) => <InputComponent {...props} />,
  email: (props) => <InputComponent {...props} />,
  phone: (props) => <InputComponent {...props} />,
  url: (props) => <InputComponent {...props} />,
  number: (props) => <InputComponent {...props} />,
  date: (props) => <InputComponent {...props} />,
  masked_text: (props) => <InputComponent {...props} />,
  text_area: (props) => <TextAreaComponent {...props} />,
  select: (props) => <SelectComponent {...props} />,
  country_select: (props) => <SelectComponent {...props} />,
  radio_group: (props) => <ChoiceGroup {...props} multiple={false} />,
  checkbox_group: (props) => <ChoiceGroup {...props} multiple />,
  multi_select: (props) => <ChoiceGroup {...props} multiple />,
  checkbox: (props) => <CheckboxComponent {...props} />,
  address: (props) => <AddressComponentView {...props} />,
  button: (props) => <ButtonView {...props} />,
};
