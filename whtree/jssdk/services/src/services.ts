import WHBridge from "@mod-system/js/internal/bridge";
export { registerAsDynamicLoadingLibrary, registerAsNonReloadableLibrary, activate as activateHMR } from "@mod-system/js/internal/hmr";
import * as path from "node:path";
export { openBackendService } from "./backendservice";
import { getBridgeService, InvokeOptions, WebHareBackendConfiguration } from "./bridgeservice";
export { WebHareBackendConfiguration } from "./bridgeservice";

let configresolve: (() => void) | null = null;
const configpromise = new Promise(resolve => configresolve = resolve as (() => void));

/** Promise that resolves as soon as the WebHare configuration is available */
export async function ready(): Promise<void> {
  //needs to be a function so we can mark a waiter so nodejs doesn't abort during `await services.ready()`
  await WHBridge.ready;
  //we also need the configuration promise to be ready..
  await configpromise;
}

/** Asynchronously invoke a HareScript fuction

    @param func - Reference to the function (in the form 'resourcename#functionname'). HareScipt and JavaScript functions are both supported.
    @param args - Arguments
    @param options - openPrimary
    @returns Promise resolving to the final function's value
*/
export async function callHareScript(func: string, args: unknown[], options?: InvokeOptions) {
  //TODO or should we be exposing callAsync here and always go through that abstraction (and remove AsyncCallFunctionFromJob from bridge.whsock Invoke?)
  return (await getBridgeService()).INVOKEANYFUNCTION(func, args, options || {});
}

let config: WebHareBackendConfiguration | null = null;

WHBridge.onConfigurationUpdate(async () => {
  const newconfig = await (await getBridgeService()).GETCONFIG();
  config = Object.freeze(newconfig);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- it has to be set at initialization.
  configresolve!();
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
