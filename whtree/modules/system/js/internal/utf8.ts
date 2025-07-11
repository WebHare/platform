import { getUTF8Length as std_getUTF8Length, limitUTF8Length as std_limitUTF8Length } from "@webhare/std";

/** @deprecated Import from '\@webhare/std' instead */
export function getUTF8Length(str: string) {
  return std_getUTF8Length(str);
}

/** @deprecated Import from '\@webhare/std' instead */
export function limitUTF8Length(str: string, len: number) {
  return std_limitUTF8Length(str, len);
}
