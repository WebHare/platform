/* Implementation of the HareScript regex builtins (used by wh::regex.whlib) for the WASM engine. As HareScript regular
   expressions closely follow ECMAScript we can simply use the native RegExp. The native engine implements the same
   contract in harescript/vm/bl_regex.cpp using PCRE2.

   HareScript strings are UTF-8 and all positions passed to and from HareScript are byte offsets, so we need to convert
   between those and UTF-16 code unit indices.
*/

const maxCachedRegExps = 256;
const regExpCache = new Map<string, RegExp>();

/** Reject ECMAScript syntax that HareScript doesn't support (the native engine rejects it too): lookbehind assertions,
    named capture groups and modifiers. These are the only groups starting with '(?' other than '(?:', '(?=' and '(?!' */
function checkUnsupportedSyntax(pattern: string, flags: string) {
  let inClass = false;
  for (let i = 0; i < pattern.length; ++i) {
    const ch = pattern[i];
    if (ch === "\\")
      ++i; //skip the escaped character
    else if (ch === "[")
      inClass = true;
    else if (ch === "]")
      inClass = false;
    else if (!inClass && ch === "(" && pattern[i + 1] === "?" && !":=!".includes(pattern[i + 2] ?? ":")) {
      const what = pattern[i + 2] !== "<" ? "Modifiers are" : pattern[i + 3] === "=" || pattern[i + 3] === "!" ? "Lookbehind assertions are" : "Named capture groups are";
      throw new SyntaxError(`Invalid regular expression: /${pattern}/${flags}: ${what} not supported`);
    }
  }
}

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";
const codePointEscape = (cp: number) => `\\u{${cp.toString(16)}}`;

/** Translate a pattern without the 'u' flag to a pattern with the same meaning in 'u' mode. Without 'u', JavaScript
    matches UTF-16 code units and could split characters outside the BMP (eg emoji), but HareScript regexes match code
    points (as the native engine does). The pattern must already be valid without the 'u' flag, this function rewrites
    the legacy (Annex B) syntax that 'u' mode doesn't allow.
*/
function translateToUnicodeMode(pattern: string): string {
  // Count the capture groups, needed to decide whether \N is a backreference or a legacy octal escape
  let numGroups = 0;
  for (let i = 0, inClass = false; i < pattern.length; ++i) {
    const ch = pattern[i];
    if (ch === "\\")
      ++i;
    else if (inClass)
      inClass = ch !== "]";
    else if (ch === "[")
      inClass = true;
    else if (ch === "(" && pattern[i + 1] !== "?")
      ++numGroups;
  }

  let out = "";
  let pos = 0;
  let inClass = false;
  const groupIsLookahead: boolean[] = [];

  /** Translate the escape at pos */
  function translateEscape(): string {
    const c = String.fromCodePoint(pattern.codePointAt(pos + 1)!);
    const start = pos;
    pos += 1 + c.length;
    if ("dDsSwWtnrfvbB".includes(c))
      return inClass && c === "B" ? "B" : "\\" + c;
    if (c === "c") {
      const letter = pattern[pos];
      if (letter && /[a-zA-Z]/.test(letter) || (inClass && letter && /[0-9_]/.test(letter))) { // \c_ and \c0-9 are allowed in classes
        ++pos;
        return codePointEscape(letter.charCodeAt(0) % 32);
      }
      pos = start + 1; // a literal backslash, the 'c' is parsed as a normal character
      return "\\\\";
    }
    if (c === "x" && /^[0-9a-fA-F]{2}/.test(pattern.slice(pos, pos + 2))) {
      pos += 2;
      return "\\x" + pattern.slice(pos - 2, pos);
    }
    if (c === "u" && /^[0-9a-fA-F]{4}/.test(pattern.slice(pos, pos + 4))) {
      pos += 4;
      return "\\u" + pattern.slice(pos - 4, pos);
    }
    if (isDigit(c)) {
      let end = pos;
      while (isDigit(pattern[end]))
        ++end;
      if (!inClass && c !== "0" && parseInt(pattern.slice(start + 1, end)) <= numGroups) { // backreference
        pos = end;
        return pattern.slice(start, end);
      }
      if (c >= "8") // identity escape
        return c;
      // Legacy octal escape: up to 3 digits if the first is 0-3, otherwise up to 2
      let value = 0;
      for (pos = start + 1; pos < start + (c <= "3" ? 4 : 3) && pattern[pos] >= "0" && pattern[pos] <= "7"; ++pos)
        value = value * 8 + Number(pattern[pos]);
      return codePointEscape(value);
    }
    // Identity escape
    if ("^$\\.*+?()[]{}|/".includes(c) || (c === "-" && inClass))
      return "\\" + c;
    return c;
  }

  /** Translate a class atom at pos, returns whether it's a class escape (like \w) */
  function translateClassAtom(): boolean {
    if (pattern[pos] === "\\") {
      const isClassEscape = "dDsSwW".includes(pattern[pos + 1]);
      out += translateEscape();
      return isClassEscape;
    }
    const ch = String.fromCodePoint(pattern.codePointAt(pos)!);
    out += ch === "-" ? "\\-" : ch; // a literal '-', range operators are added by translateClass
    pos += ch.length;
    return false;
  }

  /** Translate a class at pos. Its contents are atoms and ranges of two atoms, a '-' that is not part of a range is an
      atom itself (eg at the start or end of the class, or directly after a range) */
  function translateClass() {
    inClass = true;
    out += "[";
    ++pos;
    if (pattern[pos] === "^") {
      out += "^";
      ++pos;
    }
    while (pattern[pos] !== "]") { //the pattern has been validated, so the class is terminated
      const startIsClassEscape = translateClassAtom();
      if (pattern[pos] === "-" && pattern[pos + 1] !== "]") {
        ++pos;
        const rangeOperatorPos = out.length;
        out += "-";
        // Without 'u', a '-' next to a class escape is a literal '-' (u mode would see an invalid range)
        if (translateClassAtom() || startIsClassEscape)
          out = out.slice(0, rangeOperatorPos) + "\\" + out.slice(rangeOperatorPos);
      }
    }
    out += "]";
    ++pos;
    inClass = false;
  }

  while (pos < pattern.length) {
    const ch = pattern[pos];
    if (ch === "\\") {
      out += translateEscape();
      continue;
    }
    if (ch === "[") {
      translateClass();
      continue;
    }
    if (ch === "(") {
      const isLookahead = pattern[pos + 1] === "?" && (pattern[pos + 2] === "=" || pattern[pos + 2] === "!");
      groupIsLookahead.push(isLookahead);
      if (isLookahead) { // wrap lookaheads in a group, as u mode doesn't allow quantifiers on them
        out += "(?:" + pattern.slice(pos, pos + 3);
        pos += 3;
        continue;
      }
    } else if (ch === ")") {
      if (groupIsLookahead.pop())
        out += ")";
    } else if (ch === "{") {
      const quantifier = /^\{\d+(,\d*)?\}/.exec(pattern.slice(pos));
      if (quantifier) {
        out += quantifier[0];
        pos += quantifier[0].length;
        continue;
      }
      out += "\\{";
      ++pos;
      continue;
    } else if (ch === "}" || ch === "]") {
      out += "\\" + ch;
      ++pos;
      continue;
    }
    out += ch;
    ++pos;
  }
  return out;
}

/** Get a (cached) RegExp for the specified pattern and flags ('g', 'i', 'm' and/or 'u'). The RegExp always has the 'u'
    flag (patterns without 'u' are translated, see translateToUnicodeMode) and the 'd' flag so we get match indices */
function getRegExp(pattern: string, flags: string): RegExp {
  const key = flags + "/" + pattern;
  let re = regExpCache.get(key);
  if (re) { //move to the end of the map so it's the last to be evicted
    regExpCache.delete(key);
    regExpCache.set(key, re);
    return re;
  }

  re = new RegExp(pattern, flags); //validates the pattern, so do this before checking for unsupported syntax
  checkUnsupportedSyntax(pattern, flags);
  if (flags.includes("u"))
    re = new RegExp(pattern, flags + "d");
  else {
    const translated = translateToUnicodeMode(pattern);
    try {
      re = new RegExp(translated, flags + "ud");
    } catch (e) {
      throw new Error(`Internal error translating regular expression /${pattern}/${flags} to /${translated}/${flags}u: ${(e as Error).message}`);
    }
  }

  if (regExpCache.size >= maxCachedRegExps)
    regExpCache.delete(regExpCache.keys().next().value!);
  regExpCache.set(key, re);
  return re;
}

/** Convert a UTF-8 byte offset into a UTF-16 index. An offset inside a character moves to the start of the next
    character (like the native engine). Returns -1 if the offset is beyond the end of the data */
function byteOffsetToIndex(data: Buffer, byteOffset: number): number {
  if (byteOffset <= 0)
    return 0;
  if (byteOffset > data.length)
    return -1;
  while (byteOffset < data.length && (data[byteOffset] & 0xC0) === 0x80) //skip UTF-8 continuation bytes
    ++byteOffset;
  return data.subarray(0, byteOffset).toString("utf8").length;
}

function indexToByteOffset(str: string, index: number): number {
  return Buffer.byteLength(str.slice(0, index), "utf8");
}

export type RegExExecResult = null | {
  matches: Array<{ matched: boolean; start: number; len: number; value: string }>;
};

/** Implements __HS_INTERNAL_REGEX_EXEC: a RegExp.prototype.exec on the data, with lastindex as a byte offset */
export function regexExec(data: Buffer, lastIndex: number, pattern: string, flags: string): RegExExecResult {
  const re = getRegExp(pattern, flags);
  const str = data.toString("utf8");

  if (re.global) {
    const startIndex = byteOffsetToIndex(data, lastIndex);
    if (startIndex < 0)
      return null;
    re.lastIndex = startIndex;
  } else
    re.lastIndex = 0;

  const match = re.exec(str);
  re.lastIndex = 0;
  if (!match)
    return null;

  const matches = [];
  for (let i = 0; i < match.length; ++i) {
    const indices = match.indices![i];
    if (!indices)
      matches.push({ matched: false, start: -1, len: 0, value: "" });
    else {
      const start = indexToByteOffset(str, indices[0]);
      const value = match[i];
      matches.push({ matched: true, start, len: Buffer.byteLength(value, "utf8"), value });
    }
  }

  return { matches };
}

/** Implements __HS_INTERNAL_REGEX_REPLACE: a String.prototype.replace on the data */
export function regexReplace(data: Buffer, pattern: string, flags: string, replacement: string): string {
  const re = getRegExp(pattern, flags);
  re.lastIndex = 0;
  return data.toString("utf8").replace(re, replacement);
}
