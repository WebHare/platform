//not sure yet whether @webhare/gettid is the right module to expose parsers as public APIs

/** Resolve the new local gid
 * @param parentGid - The parent gid. Set to 'module:' when oarsing a top level gid
 * @param localGid - The local gid for the current sectionn
 * @returns New local gid
 */
export function resolveGid(parentGid: string, localGid: string): string {
  if (localGid.includes(':'))
    return localGid;
  if (!localGid)
    return parentGid;
  if (localGid.startsWith('.'))
    return parentGid + localGid;
  return parentGid.split(':')[0] + ':' + localGid;
}

/** Resolve a tid
 * @param parentGid - The parent gid. Set to 'module:' when oarsing a top level gid
 * @param name - The name to use as base for a tid
 * @param tid - The local tid value
 * @param title - A directly set 'title' avlue
 * @returns Resolved tid or title-as-tid
 */
export function resolveTid(parentGid: string, parts: {
  name?: string | null;
  tid?: string | null;
  title?: string | null;
}): string {
  if (parts.tid) {
    if (parts.tid.includes(":"))
      return parts.tid;
    if (parts.tid.startsWith('.'))
      return parentGid + parts.tid;
    return parentGid.split(':')[0] + ':' + parts.tid;
  }

  if (parts.title)
    return ":" + parts.title;
  else if (parts.title === "")
    return "";

  if (parts.name && parentGid && !parentGid.endsWith(':')) {
    return parentGid + "." + parts.name;
  }

  return "";
}
