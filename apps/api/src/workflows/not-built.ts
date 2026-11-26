/** A Workflow 8A stub's whole body: `foundation-8a` froze it, and its owner builds it. */
import { NotImplementedError } from '../errors.js';

/** 501 until its owner builds it. */
export const notBuilt = (name: string): Promise<never> =>
  Promise.reject(new NotImplementedError(`${name} is not built yet.`));
