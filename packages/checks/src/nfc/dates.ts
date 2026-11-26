/**
 * MRZ dates (`YYMMDD`) in full: a birth date is not in the future, an expiry at most 50 years
 * ahead (as the government ID extraction reads them, C31.5). A date with an unknown part is
 * `null`.
 */
const MRZ_DATE = /^\d{6}$/;
const MS_PER_YEAR = 365.25 * 86_400_000;

export function mrzDateToIso(value: string, kind: 'birth' | 'expiry', now: Date): string | null {
  if (!MRZ_DATE.test(value)) {
    return null;
  }
  const yy = Number(value.slice(0, 2));
  const rest = `-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  const modern = `${String(2000 + yy)}${rest}`;
  const limit =
    kind === 'birth'
      ? now.toISOString().slice(0, 10)
      : new Date(now.getTime() + 50 * MS_PER_YEAR).toISOString().slice(0, 10);
  return modern > limit ? `${String(1900 + yy)}${rest}` : modern;
}
