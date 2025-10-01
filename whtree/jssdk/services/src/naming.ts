/* Various 'how to name' things API */

import { nameToSnakeCase } from "@webhare/std/src/types";

export type ModuleQualifiedName = `${string}:${string}`;

/** Verify a module name is valid
 * - The name must start and end end with a letter or digit and should have a length of at least 2
 * - No names starting with 'wh_' or 'system_'
 * - No names starting with a digit, except for '4tu' which we will permit, for now.
 * - Only lowercase letters
 * - No '.', or '-' in module names (as these make it harder to derive valid TS/HS identifiers from module names)
 * - Prevent illegal names that clash with internal resource identifiers
 */
export function isValidModuleName(name: string): name is ModuleQualifiedName {
  return name === '4tu' || (/^[a-z][a-z0-9_]*[a-z0-9]$/.test(name) && !name.startsWith("wh_") && !name.startsWith("system_") && !["wh", "mod", "module", "direct"].includes(name));
}

/** Split a module scoped name
 *  @param name - Name to split
 *  @returns [module, name] or null if not a valid module scoped name
*/
export function splitModuleScopedName(name: string): string[] | null {
  // The name parts must start and end with a letter or digit and should have a length of at least 2
  // Only allow lowercase letters
  // Don't allow '.' in module names
  // Ensure the scoped name is an unambiguously url-safe slug when the ':' is replaced with a '/'
  const match = name.match(/^([^:]*):([a-z0-9][-.a-z0-9_]*[a-z0-9])$/);
  if (!match || !isValidModuleName(match[1]))
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

/** Convert a name to HS compatible snake casing.. Reject any names that are ambigous to encode (eg contain underscores, start with a letter) */
export function toHSSnakeCase(tag: string): string {
  if (!tag.match(/^[a-zA-Z0-9]+$/))
    throw new Error(`Name '${tag}' cannot be unambigously converted to a HareScript snake case name`);

  const result = nameToSnakeCase(tag);
  if (result.length > 63)
    throw new Error(`Name '${tag}' is too long`);

  return result;
}
