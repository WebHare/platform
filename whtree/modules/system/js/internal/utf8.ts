/** Return the length of the string in bytes when UTF8-encoded */
export function getUTF8Length(str: string) {
  // encodeURIComponent encodes every utf-8 byte into a character or a %<hex>. unescape translates back, but
  // but unescapes every %<hex> into a single character.
  return unescape(encodeURIComponent(str)).length;
}

export function limitUTF8Length(str: string, len: number) {
  let retval = "";
  while (str) {
    const middle = (str.length + 1) / 2;
    const teststr = str.substr(0, middle);
    const testlen = getUTF8Length(teststr);
    if (testlen > len)
      str = str.substr(0, middle - 1);
    else {
      retval += teststr;
      str = str.substr(middle);
      len -= testlen;
    }
  }
  return retval;
}
