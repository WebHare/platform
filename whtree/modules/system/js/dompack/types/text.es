// WARNING: This file is loaded by both webpack (babel) and nodejs code and
//          should avoid babel-only features not yet supported by nodejs

// import * as texttype from 'dompack/types/text';

export function encodeTextNode(str)
{
  return str.split('&').join('&amp;')
            .split('<').join('&lt;')
            .split('>').join('&gt;');
}

export function encodeValue(str)
{
  return str.split('&').join('&amp;')
            .split('<').join('&lt;')
            .split('>').join('&gt;')
            .split('"').join('&quot;')
            .split("'").join('&apos;');
}

export function decodeValue(str)
{
  return str.replace(/<br *\/?>/g, "\n")
            .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, "&");
}

export function encodeJSCompatibleJSON(s)
{
  return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
