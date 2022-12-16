export function encodeTextNode(str: string) {
  return str.split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;');
}

export function encodeValue(str: string) {
  return str.split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&apos;');
}

export function decodeValue(str: string) {
  return str.replace(/<br *\/?>/g, "\n")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function encodeJSCompatibleJSON(value: unknown) {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
