/**
 * C52.3: a business website body is its URL (an `http` or `https` URL of a named host on port 80
 * or 443, no credentials) and an optional business name; its schema says it all. The site itself
 * is never fetched (C61.3).
 */
import { NO_INPUT_RULES, type InputRule } from './rules.js';

export const businessWebsiteInputRule: InputRule = NO_INPUT_RULES;
