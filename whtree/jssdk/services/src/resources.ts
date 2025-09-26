import * as path from "node:path";
import { backendConfig } from "./config";

export function toFSPath(resource: string, options: { keepUnmatched: true }): string;
export function toFSPath(resource: string, options: { allowUnmatched: true }): string | null;
export function toFSPath(resource: string, options?: { allowUnmatched?: boolean; keepUnmatched?: boolean }): string;

/** Resolve a resource path to a filesystem path
    @param resource - Path to resolve
    @param allowUnmatched - Do not fail if the path cannot be matched to a filesystem path
    @param keepUnmatched - Return the original path if unmatched. Implies allowUnmatched
    @returns Absolute file system path. A succesful return does not imply the path actually exists
    @throws If the path cannot be mapped to a filesystem path
*/
export function toFSPath(resource: string, { allowUnmatched = false, keepUnmatched = false } = {}) {
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

    if (nextslash === -1)
      return basedir; //we'll always terminate a path like `mod::system` with a slash
    else
      return path.join(basedir, restpath.substring(nextslash));
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
  if (!getns)
    return false; //definitely not an absolute path
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
