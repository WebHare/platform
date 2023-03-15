import * as path from "node:path";
import { config } from "./config";

export function toFSPath(resource: string, options: { allowUnmatched: true }): string | null;
export function toFSPath(diskpath: string, options?: { allowUnmatched: boolean }): string;

/** Resolve a resource path to a filesystem path

    @param resource - Path to resolve
    @returns Absolute file system path. A succesful return does not imply the path actually exists
    @throws If the path cannot be mapped to a filesystem path
*/
export function toFSPath(resource: string, options?: { allowUnmatched: boolean }) {
  const namespace = resource.substring(0, resource.indexOf("::")).toLowerCase();
  const restpath = resource.substring(namespace.length + 2);

  if (namespace == "mod" || namespace == "storage") {
    const nextslash = restpath.indexOf('/');
    const modulename = nextslash == -1 ? restpath : restpath.substr(0, nextslash);
    if (modulename == "") {
      if (options?.allowUnmatched)
        return null;

      throw new Error("No such resource: missing module name");
    }

    const modinfo = config.module[modulename];
    if (!modinfo) {
      if (options?.allowUnmatched)
        return null;

      throw new Error(`No such resource: no such module '${modulename}'`);
    }

    const basedir = namespace == "mod" ? modinfo.root : `${config.dataroot}storage/${modulename}/`;

    if (nextslash == -1)
      return basedir; //we'll always terminate a path like `mod::system` with a slash
    else
      return path.join(basedir, restpath.substring(nextslash));
  }

  if (options?.allowUnmatched)
    return null;
  throw new Error(`Unsupported resource path '${resource}'`);
}

export function toResourcePath(diskpath: string, options: { allowUnmatched: true }): string | null;
export function toResourcePath(diskpath: string, options?: { allowUnmatched: boolean }): string;

/** Resolve a filesystem path back to a resource path
    @param diskpath - Path to resolve
    @param options - Set allowUnmatched to prevent a throw for paths that do not map to resource name
    @returns WebHare reosurce path. A succesful return does not imply the path actually exists, null if the path cannot be mapped
    @throws If the path cannot be mapped to a resource path and allowUnmatched is not set
*/
export function toResourcePath(diskpath: string, options?: { allowUnmatched: boolean }) {
  //FIXME is it useful for this function to throw() if it cannot match the path? The API is rarely used but no match will be quite common! (but toFSPath)
  for (const [modulename, moduleconfig] of Object.entries(config.module)) {
    if (diskpath.startsWith(moduleconfig.root))
      return `mod::${modulename}/${diskpath.substring(moduleconfig.root.length)}`;
  }

  if (options?.allowUnmatched)
    return null;

  throw new Error(`Cannot match filesystem path '${diskpath}' to a resource`);
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
    @returns Resolved resource path
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

  return basepart + path.join(basesubpath, relativepath) + append;
}
