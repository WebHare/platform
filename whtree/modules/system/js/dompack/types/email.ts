import { isValidEmail } from "@webhare/std";

/** @deprecated Use \@webhare/std isValidEmail to match WebHare's server side checks */
export function isValidEmailAddress(emailaddress: string) {
  return isValidEmail(emailaddress);
}
