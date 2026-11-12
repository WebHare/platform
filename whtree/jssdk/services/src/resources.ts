import * as path from "node:path";
import { backendConfig } from "./config";

export type ToFSPathOptions = {
  /** Do not fail if the path cannot be matched to a filesystem path */
  allowUnmatched?: boolean;
  /** Return the original path if unmatched. Implies allowUnmatched */
  keepUnmatched?: boolean;
  /** Resource path (eg `mod::mymodule/data/`) that the resolved path must stay inside. If set, '.' and '..'
      segments are permitted in the resource path, as long as the result does not escape this root nor the
      module/storage folder it was resolved against. The root itself may not contain '.' or '..' segments. */
  root?: string;
};

export function toFSPath(resource: string, options: ToFSPathOptions & { keepUnmatched: true }): string;
export function toFSPath(resource: string, options: ToFSPathOptions & { allowUnmatched: true }): string | null;
export function toFSPath(resource: string, options?: ToFSPathOptions): string;

/** Resolve a resource path to a filesystem path
    @param resource - Path to resolve
    @param options - Options, see {@link ToFSPathOptions}
    @returns Absolute file system path. A succesful return does not imply the path actually exists
    @throws If the path cannot be mapped to a filesystem path, if it contains '.' or '..' segments (and no root is set),
            or if it escapes the specified root or its module/storage folder
*/
export function toFSPath(resource: string, { allowUnmatched = false, keepUnmatched = false, root }: ToFSPathOptions = {}) {
  //Validate dot segments before resolving, so unmatched resource paths (eg `mod::missing/../x`) are rejected too.
  //Input that isn't a resource path we'd resolve (eg a disk path with keepUnmatched) is passed through as-is
  const hasDotSegments = resource.split("/").some(segment => segment === "." || segment === "..");
  const isResolvablePath = /^(@webhare\/|@mod-|(mod|storage)::)/i.test(resource);
  if (hasDotSegments && isResolvablePath && root === undefined)
    throw new Error(`Invalid resource path '${resource}': '.' and '..' path segments are not allowed`);

  const resolved = resolveFSBase(resource, { allowUnmatched, keepUnmatched });
  if (resolved === null) //unmatched and allowUnmatched: no path is returned, so nothing can escape
    return null;
  if (typeof resolved === "string") { //unmatched and keepUnmatched
    if (root !== undefined) //we can't verify containment of a path we don't understand
      throw new Error(`Invalid resource path '${resource}': it cannot be resolved inside the root '${root}'`);
    return resolved;
  }

  const { basedir, subpath } = resolved;
  let result = path.join(basedir, subpath);
  if (hasDotSegments && [".", ".."].includes(subpath.split("/").at(-1)!) && !result.endsWith("/"))
    result += "/"; //'x/..' refers to a directory, keep the trailing slash like we do for `mod::system`

  if (!isInsideDir(result, basedir))
    throw new Error(`Invalid resource path '${resource}': it escapes its base folder`);

  if (root === undefined)
    return result;

  const rootpath = toFSPath(root); //throws if root itself is invalid or contains dot segments
  if (!isInsideDir(result, rootpath))
    throw new Error(`Invalid resource path '${resource}': it escapes the root '${root}'`);

  return result;
}

/** Test whether a (normalized) path is equal to or inside a directory */
function isInsideDir(testpath: string, dir: string) {
  const dirWithSlash = dir.endsWith("/") ? dir : dir + "/";
  return testpath === dirWithSlash || testpath === dirWithSlash.slice(0, -1) || testpath.startsWith(dirWithSlash);
}

/** Split a resource into the filesystem base directory it maps to and the remaining subpath */
function resolveFSBase(resource: string, { allowUnmatched, keepUnmatched }: { allowUnmatched: boolean; keepUnmatched: boolean }): { basedir: string; subpath: string } | string | null {
  if (resource.startsWith("@webhare/"))
    return { basedir: backendConfig.installationRoot + "jssdk/", subpath: resource.substring(9) };

  if (resource.startsWith("@mod-"))
    resource = `mod::${resource.substring(5)}`;

  const namespace = resource.substring(0, resource.indexOf("::")).toLowerCase();
  const restpath = resource.substring(namespace.length + 2);

  if (namespace === "mod" || namespace === "storage") {
    const nextslash = restpath.indexOf('/');
    const modulename = nextslash === -1 ? restpath : restpath.substr(0, nextslash);
    if (modulename === "") {
      if (keepUnmatched)
        return resource;
      if (allowUnmatched)
        return null;

      throw new Error("No such resource: missing module name");
    }

    const modinfo = backendConfig.module[modulename];
    if (!modinfo) {
      if (keepUnmatched)
        return resource;
      if (allowUnmatched)
        return null;

      throw new Error(`No such resource: no such module '${modulename}'`);
    }

    const basedir = namespace === "mod" ? modinfo.root : `${backendConfig.dataRoot}storage/${modulename}/`;

    //we'll always terminate a path like `mod::system` with a slash
    return { basedir, subpath: nextslash === -1 ? "" : restpath.substring(nextslash + 1) };
  }

  if (keepUnmatched)
    return resource;
  if (allowUnmatched)
    return null;
  throw new Error(`Unsupported resource path '${resource}'`);
}

export function toResourcePath(diskpath: string, options: { keepUnmatched: true }): string;
export function toResourcePath(diskpath: string, options: { allowUnmatched: true }): string | null;
export function toResourcePath(diskpath: string, options?: { allowUnmatched?: boolean; keepUnmatched?: boolean }): string;

/** Resolve a filesystem path back to a resource path
    @param diskpath - Path to resolve
    @param allowUnmatched - Do not fail if the path cannot be matched to a filesystem path
    @param keepUnmatched - Return the original path if unmatched. Implies allowUnmatched
    @returns WebHare resource path. A succesful return does not imply the path actually exists, null if the path cannot be mapped
    @throws If the path cannot be mapped to a resource path and allowUnmatched is not set
*/
export function toResourcePath(diskpath: string, { allowUnmatched = false, keepUnmatched = false } = {}) {
  //FIXME is it useful for this function to throw() if it cannot match the path? The API is rarely used but no match will be quite common! (but toFSPath)
  for (const [modulename, moduleconfig] of Object.entries(backendConfig.module)) {
    if (diskpath.startsWith(moduleconfig.root))
      return `mod::${modulename}/${diskpath.substring(moduleconfig.root.length)}`;
  }

  if (keepUnmatched)
    return diskpath;
  if (allowUnmatched)
    return null;

  throw new Error(`Cannot match filesystem path '${diskpath}' to a resource`);
}

interface ParsedResourcePath {
  namespace: string;
  subpath: string;
  module?: string;
  hash?: string;
}

//TODO should we interpret the full set of isAbsoltueResource? do our users want that?
export function parseResourcePath(resourcepath: string): ParsedResourcePath | null {
  const getns = resourcepath.match(/^(mod::([^/]+)\/|storage::([^/]+)\/|(.+)::)([^#]*)(#.+)?/);
  if (!getns)
    return null;
  if (getns[2] || getns[3]) //either mod::[2] or storage:[3] matched
    return { namespace: getns[2] ? "mod" : "storage", module: getns[2] || getns[3], subpath: getns[5], ...(getns[6] ? { hash: getns[6] } : null) };

  const namespace = getns[1].substring(0, getns[1].length - 2);
  if (!['site', 'whfs'].includes(namespace))
    return null; //TODO support other namespaces? parse site name ?

  return { namespace, subpath: getns[5], ...(getns[6] ? { hash: getns[6] } : null) };
}

/** Returns whether a resource path is an absolute path
    @param resourcepath - Resource path to test
    @returns true if the resource path is an absolute path
*/
export function isAbsoluteResource(resourcepath: string): boolean {
  const getns = resourcepath.match(/^([^/]*)::.+/);
  if (!getns) {
    if (resourcepath.match(/^(@mod-|@webhare\/|node:)/))
      return true;
    return false; //definitely not an absolute path
  }
  if (['mod', 'storage', 'inline', 'inline-base64', 'site', 'whfs'].includes(getns[1]))
    return true; //absolute path, valid namespae
  if (['module', 'moduleroot', 'moduledata', 'wh', 'whres', 'direct'].includes(getns[1])) //on the fence about enabling direct:: ?
    throw new Error(`Namespace '${getns[1]}' is not supported in the JavaScript APIs`);

  throw new Error(`Invalid namespace '${getns[1]}'`);
}

/** Resolves a (relative) resource path relative to a base path
    @param base - Base resource path
    @param relativepath - Resource path to resolve
    @returns Resolved resource path. If relativepath is empty or already absolute, it is returned as-is
    @throws If the subpath is invalid
*/
export function resolveResource(base: string, relativepath: string): string {
  if (!base)
    throw new Error(`Cannot make an absolute resource path for '${relativepath}' if invoked without a base path`);
  if (!isAbsoluteResource(base))
    throw new Error(`Cannot make an absolute resource path if our base path '${base}' is not absolute`);
  if (!relativepath || isAbsoluteResource(relativepath))
    return relativepath;

  const append = relativepath.indexOf('#') >= 0 ? relativepath.substring(relativepath.indexOf('#')) : '';
  if (append)
    relativepath = relativepath.substring(0, relativepath.length - append.length);

  // Get the base part we want to protect ("wh::"" or "mod::<modulename>/")
  // TODO? wh:: and whres:: required specific protection but we're not sure if we'll even support them
  const basepart = base.split('/')[0];

  // Ensure the base path starts with '/', strip the last non-directory component
  let basesubpath = base.substring(basepart.length);
  if (!basesubpath.endsWith('/'))
    basesubpath = basesubpath.substring(0, basesubpath.lastIndexOf('/') + 1);

  if (!path.join("/__canary__/", basesubpath, relativepath).startsWith("/__canary__/"))
    throw new Error(`Cannot resolve an absolute resource path for '${relativepath}' that tries to escape from the base folder of '${base}'`);

  if (relativepath.startsWith("/"))
    return basepart + relativepath + append;

  let basepath = basepart + path.join(basesubpath, relativepath);
  if (!basepath.endsWith('/') && [".", ".."].includes(path.basename(relativepath)) ? "/" : "")
    basepath += '/';
  return basepath + append;
}

/** Returns the event mask for a specific resource */
export function getResourceEventMasks(resources: string | Iterable<string>): string[] {
  resources = typeof resources === "string" ? [resources] : resources;
  const masks = new Set<string>();
  for (const resource of resources) {
    const resourcePath = toResourcePath(resource, { allowUnmatched: true, keepUnmatched: true });
    const resourceDir = resourcePath.substring(0, resourcePath.lastIndexOf('/') + 1);
    if (resourceDir.startsWith("mod::")) {
      const moduleName = resourceDir.substring(5, (resourceDir + "/").indexOf('/', 5));
      masks.add(`system:moduleupdate.${moduleName}`);
    }
    masks.add(`system:modulefolder.${resourceDir}`);
  }
  return [...masks].sort((a, b) => a < b ? -1 : 1);
}
