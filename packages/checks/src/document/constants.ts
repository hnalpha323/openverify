/**
 * The C60.5 classifier constants (provisional, ours, fixed in the plan; never tuned on the
 * generated set, H23). `classify.ts` re-exports them.
 */
export const DOCUMENT_CLASSIFIER_CONSTANTS = Object.freeze({
  /** The softmax temperature. */
  temperature: 1.0,
  /** The constant score of `other`. */
  otherScore: 2.0,
  /** The least lead over the runner-up a class needs; within it the class is `unknown`. */
  minMargin: 0.15,
  /** The weight of an anchor, a medium and a weak cue. */
  cueWeights: Object.freeze({ anchor: 3, medium: 2, weak: 1 }),
  /** The most times one phrase counts. */
  maxRepeats: 3,
  /**
   * OCR tolerance (research, docs/research/phase5-libraries.md §1.5): a word of 5 letters or more
   * reads as a lexicon word at Jaro-Winkler 0.93 or above.
   */
  fuzzySimilarity: 0.93,
  fuzzyMinLength: 5,
  /** Identity labels of one language that mark an identity document (ours). */
  identityLabels: 3,
});
