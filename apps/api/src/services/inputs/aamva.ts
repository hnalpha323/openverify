/**
 * C52.3: the AAMVA form takes a US driver licence or ID card as printed; its body schema says it
 * all (`aamvaInputsSchema`: the required members, a US jurisdiction, ISO dates, a US ZIP code).
 * The silent step's values are copied by the server (C59.6), never entered.
 */
import { NO_INPUT_RULES, type InputRule } from './rules.js';

export const aamvaInputRule: InputRule = NO_INPUT_RULES;
