function _min(d0: number, d1: number, d2: number, bx: number, ay: number) {
  return d0 < d1 || d2 < d1
    ? d0 > d2
      ? d2 + 1
      : d0 + 1
    : bx === ay
      ? d1
      : d1 + 1;
}

/* calculateLevenshteinDistance is adopted from https://github.com/gustf/js-levenshtein/blob/master/index.js, licensed MIT © Gustaf Andersson
   Picked over fastest-levenshtein because a permanent 256KB memory area for a bit more speed doesn't seem worth it
*/
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (a.length > b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  let la = a.length;
  let lb = b.length;

  while (la > 0 && (a.charCodeAt(la - 1) === b.charCodeAt(lb - 1))) {
    la--;
    lb--;
  }

  let offset = 0;

  while (offset < la && (a.charCodeAt(offset) === b.charCodeAt(offset))) {
    offset++;
  }

  la -= offset;
  lb -= offset;

  if (la === 0 || lb < 3) {
    return lb;
  }

  let x = 0;
  let y, d0, d1, d2, d3, dd = 0, dy, ay, bx0, bx1, bx2, bx3;

  const vector: number[] = [];

  for (y = 0; y < la; y++) {
    vector.push(y + 1);
    vector.push(a.charCodeAt(offset + y));
  }

  const len = vector.length - 1;

  for (; x < lb - 3;) {
    bx0 = b.charCodeAt(offset + (d0 = x));
    bx1 = b.charCodeAt(offset + (d1 = x + 1));
    bx2 = b.charCodeAt(offset + (d2 = x + 2));
    bx3 = b.charCodeAt(offset + (d3 = x + 3));
    dd = (x += 4);
    for (y = 0; y < len; y += 2) {
      dy = vector[y];
      ay = vector[y + 1];
      d0 = _min(dy, d0, d1, bx0, ay);
      d1 = _min(d0, d1, d2, bx1, ay);
      d2 = _min(d1, d2, d3, bx2, ay);
      dd = _min(d2, d3, dd, bx3, ay);
      vector[y] = dd;
      d3 = d2;
      d2 = d1;
      d1 = d0;
      d0 = dy;
    }
  }

  for (; x < lb;) {
    bx0 = b.charCodeAt(offset + (d0 = x));
    dd = ++x;
    for (y = 0; y < len; y += 2) {
      dy = vector[y];
      vector[y] = dd = _min(dy, d0, dd, bx0, vector[y + 1]);
      d0 = dy;
    }
  }

  return dd;
}

/** Find the best match for a string fiven a list of alternatives. Defaults to case insensitive match.
    @param name - Name to search
    @param alternatives - Alternatives to choose from
    @param matchCase - Do a case sensitive compare (defaults to FALSE)
    @returns Best match or null if none found
*/
export function getBestMatch(name: string, alternatives: string[], { matchCase = false } = {}): string | null {
  if (!matchCase)
    name = name.toLowerCase();

  const threshold = name.length < 3 ? 1 : 2;
  const matches = alternatives.
    map((value) => ({ value, distance: levenshteinDistance(name, matchCase ? value : value.toLowerCase()) })).
    filter((match) => match.distance <= threshold).
    sort((a, b) => a.distance - b.distance);

  return matches[0]?.value || null;
}

/** Return match info as text to append to the end of a message
    @param name - Name to search
    @param alternatives - Alternatives to choose from
    @param matchCase - Do a case sensitive compare (defaults to FALSE)
    @returns Returns ", did you mean 'XXX'?" text if a better match was found, otherwise an empty string
    @example throw new Error(`${libname} does not export '${name}'${addBestMatch(name, Object.keys(lib))}`);

*/
export function addBestMatch(name: string, alternatives: string[], { matchCase = false } = {}): string {
  const match = getBestMatch(name, alternatives, { matchCase });
  return match ? `, did you mean '${match}'?` : "";
}
