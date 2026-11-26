import type { ProblemFieldError } from '../../errors.js';

/** A problem's pointer into the request body. Details are ours, and never hold a value (C100.4). */
export const fieldError = (pointer: string, detail: string): ProblemFieldError => ({
  location: 'body',
  pointer,
  detail,
});
