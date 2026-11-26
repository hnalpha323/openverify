/** The phone number verification in words (C55, C56, C66): what a pass means. */

/**
 * C66: what a passed phone number verification means, as `docs/checks/contact.md` says it (its
 * test checks the sentences against that page).
 */
export const PHONE_NUMBER_PASS_MEANS =
  'The user entered the code that was sent by text message to that number, within its lifetime. ' +
  'It shows that they could read messages sent to the number at that moment. ' +
  'It does not establish who the person is, that the number belongs to them, or that they will keep it: a number can be ported, reassigned or read on a swapped SIM card.';
