/** Is this a valid indexname for use in Consilio?

    @param name - Name to check
    @returns true if the name is a valid indexname
*/
export function isValidIndexName(name: string): boolean {
  //Our API integration currently needs to be able to fix an indexname into 64 characters, so we'll allocate 40 chars for the index name

  //We want to reserve '-' to detect suffixes, reserve names starting with _ and . for internal/dashboard stuff, and just limit names further to be on the safe side
  return /^[a-z][_a-z0-9]*$/.test(name) && name.length <= 40 && !name.endsWith("_");
}

/** Is this a valid suffix for use in Consilio?
    @param suffix -  Suffix to check
    @returns true if the suffix is a valid suffix
*/
export function isValidIndexSuffix(suffix: string): boolean {
  //We'll try to be safe, but accept things that look like dates (2022-05).
  //64 - 40 - 1(suffix separator) = 23 remaining for the suffix.. let's give it 16 and have headroom left...
  return /^[a-z0-9]+[-_a-z0-9]+$/.test(suffix) && suffix.length < 16 && !["_", "-"].includes(suffix.at(-1)!);
}
