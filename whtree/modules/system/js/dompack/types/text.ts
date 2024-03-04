export function encodeTextNode(str: string) {
  return str.split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;');
}

/** @deprecated You should use encodeString(str, 'attribute') */
export function encodeValue(str: string) {
  return encodeEntities(str, false);
}

/** @deprecated You should use decodeString(str, 'attribute') */
export function decodeValue(str: string) {
  return str.replace(/<br *\/?>/g, "\n")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** @deprecated You should use encodeString(str, 'html') */
export function encodeHTML(str: string) {
  return encodeEntities(str, true);
}

function encodeEntities(str: string, html: boolean) {
  let s = "";
  for (const char of str) {
    const curch = char.codePointAt(0);
    if (curch === undefined || isHTMLUnrepresentableChar(curch))
      continue;
    if (curch >= 32 && curch < 128 && curch !== 38 && curch !== 60 && curch !== 62) {
      s += String.fromCodePoint(curch);
      continue;
    }

    switch (curch) {
      case 10:
        {
          if (html) {
            s += "<br />";
            continue;
          }
          break;
        }
      case 13:
        {
          if (html)
            continue;
          break;
        }
      case 34:
        {
          s += "&quot;";
          continue;
        }
      case 38:
        {
          s += "&amp;";
          continue;
        }
      case 39:
        {
          s += "&apos;";
          continue;
        }
      case 60:
        {
          s += "&lt;";
          continue;
        }
      case 62:
        {
          s += "&gt;";
          continue;
        }
    }

    s += "&#" + curch + ";";
  }
  return s;
}

function isHTMLUnrepresentableChar(curch: number) {
  return (curch < 32 && curch !== 9 && curch !== 10 && curch !== 13)
    || (curch >= 128 && curch <= 159);
}
