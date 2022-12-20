import WHBridge, { VersionData } from "@mod-system/js/internal/bridge";
export { registerAsDynamicLoadingLibrary, registerAsNonReloadableLibrary, activate as activateHMR } from "@mod-system/js/internal/hmr";
import * as path from "node:path";

/** Promise that resolves as soon as the WebHare configuration is available */
export function ready(): Promise<void> {
  //needs to be a function so we can mark a waiter so nodejs doesn't abort during `await services.ready()`
  return WHBridge.ready;
}

/** Asynchronously invoke a HareScript fuction

    @param func - Reference to the function (in the form 'resourcename#functionname'). HareScipt and JavaScript functions are both supported.
    @param args - Arguments
    @param options - openPrimary
    @returns Promise resolving to the final function's value
*/
export async function callHareScript(func: string, args: unknown[], options?: { openPrimary: boolean }) {
  //TODO or should we be exposing callAsync here and always go through that abstraction (and remove AsyncCallFunctionFromJob from bridge.whsock Invoke?)
  return WHBridge.invoke(func, args, options);
}

export interface WebHareModuleConfiguration {
  /** Module's version */
  // version: string; // TODO
  /** Absolute path to module root data */
  root: string;
}

type WebHareModuleMap = { [name: string]: WebHareModuleConfiguration };

/** Describes the configuration of a WebHare backend */
export interface WebHareBackendConfiguration {
  /** Absolute path to WebHare installation, ending with a slash, eg /opt/wh/whtree/ */
  installationroot: string;
  /** Absolute path to WebHare data root, ending with a slash. Usually /opt/whdata/ */
  dataroot: string;

  //not sure if we really need ALL those other paths we used to have
  module: WebHareModuleMap;
}

let config: WebHareBackendConfiguration | null = null;

function buildModuleInfo(moduleroots: object) {
  const map: WebHareModuleMap = {};
  for (const [modulename, data] of Object.entries(moduleroots))
    map[modulename] = { root: data };
  return map;
}

WHBridge.onConfigurationUpdate(versioninfo => {
  //bridge versioninfo should probably just exactly follow WebHareBackendConfiguration but let's do that when we have only one bridge implementation left
  const vdata = versioninfo as VersionData;
  const newconfig = {
    installationroot: vdata.installationroot,
    dataroot: vdata.varroot,
    module: buildModuleInfo(vdata.moduleroots)
  };
  config = Object.freeze(newconfig);
});

export function getConfig(): Readonly<WebHareBackendConfiguration> {
  if (!config)
    throw new Error("WebHare services are not yet available. You may need to await services.ready()");

  return config;
}

/** Resolve a resource path to a filesystem path

    @param resource - Path to resolve
    @returns Absolute file system path. A succesful return does not imply the path actually exists
    @throws If the path cannot be mapped to a filesystem path
*/
export function toFSPath(resource: string) {
  const namespace = resource.substring(0, resource.indexOf("::")).toLowerCase();
  const restpath = resource.substring(namespace.length + 2);

  if (namespace == "mod" || namespace == "storage") {
    const nextslash = restpath.indexOf('/');
    const modulename = nextslash == -1 ? restpath : restpath.substr(0, nextslash);
    if (modulename == "")
      // throw new RetrieveResourceException(reportpath, "No such resource: missing module name", default let );
      throw new Error("No such resource: missing module name");

    const modinfo = getConfig().module[modulename];
    if (!modinfo)
      throw new Error(`No such resource: no such module '${modulename}'`);

    const basedir = namespace == "mod" ? modinfo.root : `${getConfig().dataroot}storage/${modulename}/`;

    if (nextslash == -1)
      return basedir; //we'll always terminate a path like `mod::system` with a slash
    else
      return path.join(basedir, restpath.substring(nextslash));
  }
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
  for (const [modulename, moduleconfig] of Object.entries(getConfig().module)) {
    if (diskpath.startsWith(moduleconfig.root))
      return `mod::${modulename}/${diskpath.substring(moduleconfig.root.length)}`;
  }

  if (options?.allowUnmatched)
    return null;

  throw new Error(`Cannot match filesystem path '${diskpath}' to a resource`);
}

export async function openBackendService(name: string, args?: unknown[], options?: { timeout: number }) {
  return WHBridge.openService(name, args, options);
}
