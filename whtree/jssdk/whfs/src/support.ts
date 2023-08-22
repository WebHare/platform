/** Whether the name is acceptable for use in WHFS
 * @param name - The name to check
 * @param allowSlashes - Whether to allow slashes in the name (default: false)
*/
export function isValidName(name: string, { allowSlashes = false }: { allowSlashes?: boolean } = {}): boolean {
  if (typeof name !== "string" || !name)
    return false;

  //Don't permit filenames starting with a space, ^ or ! or ending in a dot or a space (this also filters "." and "..")
  if (['^', '!', ' '].includes(name[0]))
    return false;

  if (['.', ' '].includes(name.at(-1)!))
    return false;

  if (!allowSlashes && name.includes("/"))
    return false;

  // eslint-disable-next-line no-control-regex -- we really want to match control characters here
  if (name.match(/[\x00-\x1f\\:*?"<>|]/)) //non printable chars/wihtespcae
    return false;

  return true;
}
