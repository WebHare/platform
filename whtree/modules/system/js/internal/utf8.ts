/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation


/* Return the length of the string in bytes when UTF8-encoded */
function getUTF8Length(str) {
  // encodeURIComponent encodes every utf-8 byte into a character or a %<hex>. unescape translates back, but
  // but unescapes every %<hex> into a single character.
  return unescape(encodeURIComponent(str)).length;
}

function limitUTF8Length(str, len) {
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

exports.getUTF8Length = getUTF8Length;
exports.limitUTF8Length = limitUTF8Length;
