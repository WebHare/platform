import { isValidEmail } from "@webhare/std";

/** @deprecated Use \@webhare/std isValidEmail to match WebHaer's server side checks */
export function isValidEmailAddress(emailaddress: string) {
  return isValidEmail(emailaddress);
}
