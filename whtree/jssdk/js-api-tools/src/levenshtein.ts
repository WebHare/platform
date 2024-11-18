import { levenshteinDistance } from "@webhare/std";

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
