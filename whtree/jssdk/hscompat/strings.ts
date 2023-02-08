import { wildcardsToRegExp } from "@webhare/std/strings";

export function isLike(text: string, mask: string): boolean {
  return new RegExp(wildcardsToRegExp(mask)).test(text);
}

export function isNotLike(text: string, mask: string): boolean {
  return !isLike(text, mask);
}
