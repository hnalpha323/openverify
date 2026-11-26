import type { ReasonText } from '../check-reasons';

/** One verification type's reason codes in words (C54.5), each as `reasonText` returns it. */
export type ReasonWords = Readonly<Record<string, ReasonText>>;
