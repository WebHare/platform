function isNotExcluded<T extends string, K extends string>(t: T, excludes: K[]): t is Exclude<T, K> {
  return !excludes.includes(t as unknown as K);
}

export function excludeKeys<T extends string, K extends string>(t: T[], k: K[]): Array<Exclude<T, K>> {
  const result = new Array<Exclude<T, K>>;
  for (const a of t)
    if (isNotExcluded(a, k))
      result.push(a);
  return result;
}

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

const PublishedFlag_OncePublished = 100000;

function testFlagFromPublished(published: number, flag_to_test: number) {
  return ((published % (flag_to_test * 2)) / flag_to_test) === 1;
}

function getErrorFromPublished(published: number) {
  return published % 100000;
}

/** @returns True if the file was erver succesfully published (its file.url cell is valid) */
function getOncePublishedFromPublished(published: number) {
  return testFlagFromPublished(published, PublishedFlag_OncePublished);
}

export function isPublish(published: number) {
  return getErrorFromPublished(published) !== 0 || getOncePublishedFromPublished(published);
}

export function formatPathOrId(path: number | string) {
  return typeof path === "number" ? `#${path}` : `'${path}'`;
}

export function isReadonlyWHFSSpace(path: string) {
  path = path.toUpperCase();
  return path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS/SNAPSHOTS/") ||
    path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-VERSIONS/") ||
    path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-VERSIONARCHIVE/") ||
    path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-DRAFTS/");
}
