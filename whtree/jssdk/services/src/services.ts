import WHBridge, { VersionData } from "@mod-system/js/internal/bridge";

/** Promise that resolves as soon as the WebHare configuration is available */
export function ready() : Promise<void> {
  //needs to be a function so we can mark a waiter so nodejs doesn't abort during `await services.ready()`
  return WHBridge.ready;
}

/** Asynchronously invoke a HareScript fuction

    @param func - Reference to the function (in the form 'resourcename#functionname'). HareScipt and JavaScript functions are both supported.
    @param args - Arguments
    @returns Promise resolving to the final function's value
*/
export async function callHareScript(func: string, args: unknown[]) {
  //TODO or should we be exposing callAsync here and always go through that abstraction (and remove AsyncCallFunctionFromJob from bridge.whsock Invoke?)
  return WHBridge.invoke(func,args);
}

export interface WebHareModuleConfiguration
{
  /** Module's version */
  // version: string; // TODO
  /** Absolute path to module root data */
  root: string;
}

type WebHareModuleMap = { [name:string]: WebHareModuleConfiguration };

/** Describes the configuration of a WebHare backend */
export interface WebHareBackendConfiguration {
  /** Absolute path to WebHare installation, ending with a slash, eg /opt/wh/whtree/ */
  installationroot: string;
  /** Absolute path to WebHare data root, ending with a slash. Usually /opt/whdata/ */
  dataroot: string;

  //not sure if we really need ALL those other paths we used to have
  module: WebHareModuleMap;
}

let config : WebHareBackendConfiguration | null = null;

function buildModuleInfo(moduleroots: object)
{
  const map: WebHareModuleMap = {};
  for(const [modulename, data] of Object.entries(moduleroots))
    map[modulename] = { root: data };
  return map;
}

WHBridge.on("versioninfo", versioninfo =>
{
  //bridge versioninfo should probably just exactly follow WebHareBackendConfiguration but let's do that when we have only one bridge implementation left
  const vdata = versioninfo as VersionData;
  const newconfig = { installationroot: vdata.installationroot
                    , dataroot: vdata.varroot
                    , module: buildModuleInfo(vdata.moduleroots)
                    };
  config = Object.freeze(newconfig);
});

export function getConfig() : Readonly<WebHareBackendConfiguration> {
  if(!config)
    throw new Error("WebHare services are not yet available. You may need to await services.ready()");

  return config;
}