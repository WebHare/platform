/* Various 'how to name' things API */

/** Split a module scoped name
 *  @param name - Name to split
 *  @returns [module, name] or null if not a valid module scoped name
*/
export function splitModuleScopedName(name: string): string[] | null {
  // The name parts must start end end with a letter or digit and should have a length of at least 2
  // Only allow lowercase letters
  // Don't allow '.' in module names
  // Ensure the scoped name is an unambiguously url-safe slug when the ':' is replaced with a '/'
  const match = name.match(/^([a-z0-9][-a-z0-9_]*[a-z0-9]):([a-z0-9][-.a-z0-9_]*[a-z0-9])$/);
  if (!match || match[1].startsWith("wh_") || match[1].startsWith("system_"))
    return null;
  return [match[1], match[2]];
}

/** Is a valid module scoped name (eg module:seomthing). */
export function isValidModuleScopedName(eventname: string): boolean {
  const split = splitModuleScopedName(eventname);
  return Boolean(split);
}

/** Check and split a module scoped name. Throws if invalid
 *  @param name - Name to split
 *  @returns [module, name]
*/
export function checkModuleScopedName(name: string): string[] {
  const split = splitModuleScopedName(name);
  if (!split)
    throw new Error(`Invalid name for module-scoped resource '${name}'`);

  return split;
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

/** Prefix a name with a module name if it has no prefix yet */
export function addModule(module: string, name: string) {
  return name && !name.includes(":") ? `${module}:${name}` : name;
}
