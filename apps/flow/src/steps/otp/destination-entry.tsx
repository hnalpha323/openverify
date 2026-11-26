import { Alert, Button, Card, Field, Input } from '@openverify/ui';
import { useMemo, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../session/use-intl-locale';
import { SelectField } from '../../components/select-field';
import { phoneCountries } from './destinations';

/** Why a destination was not taken: the browser's own checks, then the server's (C52.7). */
export type EntryError =
  | 'required'
  | 'invalid'
  | 'notAllowed'
  | 'destinationInvalid'
  | 'deliveryFailed'
  | 'notSent'
  | 'tooSoon';

export interface PhoneEntryValue {
  readonly country: string;
  readonly number: string;
}

interface EntryProps {
  readonly error: EntryError | null;
  readonly sending: boolean;
  readonly onSend: () => void;
  /** What is above the fields: the intro, the attempt and the previous attempt's hints. */
  readonly header: ReactNode;
  /** A request that failed for another reason, said above Send code. */
  readonly failure: ReactNode;
}

function useEntryError(channel: 'phone' | 'email', error: EntryError | null): string | undefined {
  const { t } = useTranslation();
  if (error === null) {
    return undefined;
  }
  if (error === 'notSent' || error === 'tooSoon') {
    return t(`otp.code.errors.${error}`);
  }
  return t(`otp.${channel}.errors.${error}`);
}

/** The form around the fields: Send code submits it, in script only (the CSP has no action). */
function EntryForm({
  title,
  header,
  failure,
  sending,
  onSend,
  children,
}: Omit<EntryProps, 'error'> & { readonly title: string; readonly children: ReactNode }) {
  const { t } = useTranslation();
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sending) {
      onSend();
    }
  };
  return (
    <Card title={title} headingLevel={1}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6">
        {header}
        {children}
        {failure}
        {sending && <p role="status">{t('otp.sending')}</p>}
        <Button
          type="submit"
          className="aria-disabled:cursor-progress sm:self-end"
          // Not `disabled`: a disabled button loses focus.
          aria-disabled={sending ? true : undefined}
        >
          {t('otp.send')}
        </Button>
      </form>
    </Card>
  );
}

/** C64.1: a country chosen from the step's allowed countries, then the number. */
export function PhoneEntry({
  allowedCountries,
  value,
  onChange,
  ...props
}: EntryProps & {
  readonly allowedCountries: readonly string[];
  readonly value: PhoneEntryValue;
  readonly onChange: (value: PhoneEntryValue) => void;
}) {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  const language = intlTag;
  const error = useEntryError('phone', props.error);
  const options = useMemo(
    () =>
      phoneCountries(allowedCountries, language).map(({ code, name, callingCode }) => ({
        value: code,
        label:
          callingCode === null
            ? name
            : t('otp.phone.countryOption', { country: name, code: callingCode }),
      })),
    [allowedCountries, language, t],
  );

  return (
    <EntryForm title={t('otp.phone.title')} {...props}>
      <div className="flex flex-col gap-4">
        <SelectField
          label={t('otp.phone.country')}
          options={options}
          value={value.country}
          autoComplete="country"
          onChange={(event) => {
            onChange({ ...value, country: event.target.value });
          }}
        />
        <Field label={t('otp.phone.number')} description={t('otp.phone.numberHint')} error={error}>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={value.number}
            onChange={(event) => {
              onChange({ ...value, number: event.target.value });
            }}
          />
        </Field>
      </div>
    </EntryForm>
  );
}

/** C64.1: the email address to send a code to. */
export function EmailEntry({
  value,
  onChange,
  ...props
}: EntryProps & { readonly value: string; readonly onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const error = useEntryError('email', props.error);

  return (
    <EntryForm title={t('otp.email.title')} {...props}>
      <Field label={t('otp.email.address')} error={error}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </Field>
    </EntryForm>
  );
}

/** A failed request, said in the words of `errorMessageKey`. */
export function RequestFailure({ message }: { readonly message: string | null }) {
  return message === null ? null : <Alert tone="error">{message}</Alert>;
}
