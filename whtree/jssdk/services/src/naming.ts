/* Various 'how to name' things API */

/** Split a module scoped name
 *  @param name - Name to split
 *  @returns [module, name] or null if not a valid module scoped name
*/
export function splitModuleScopedName(name: string) {
  const match = name.match(/^([a-z][a-z0-9_]+):(.+)$/);
  if (!match || match[1].startsWith("wh_") || match[1].startsWith("system_"))
    return null;
  return [match[1], match[2]];
}

/** Is a valid module scoped name (eg module:seomthing). */
export function isValidModuleScopedName(eventname: string) {
  const split = splitModuleScopedName(eventname);
  return Boolean(split);
}

/** Backend event names must be of format <modulename>:<eventname> - eventnames are alphanumeric and may contain dots */
export function isValidBackendEventName(eventname: string) {
  const split = splitModuleScopedName(eventname);
  return split && /^[a-z][a-z0-9.]*$/.test(split[1]);
}

/** Splits a reference in the form file#name-within-file */
export function splitFileReference(ref: string): { file: string; name: string } | null {
  const parts = ref.split("#");
  if (parts.length !== 2)
    return null;
  return { file: parts[0], name: parts[1] };
}
