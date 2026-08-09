/* frontend-config parses the wh-config object in the browser and mocks any missing data. @webhare/env does not actually expose this config, @webhare/frontend does
   The frontend configuration is built in PageBuildRequest's 'frontendConfig' member */

import type { DTAPStage } from "@webhare/env/src/concepts";
import { debugFlags, initEnv } from "@webhare/env/src/envbackend";
import { getBrowserDebugFlags } from "@webhare/env/src/init-browser";
import { getLang } from "@webhare/dompack/src/tree";
import type { FrontendDataTypes } from "@webhare/frontend";
import { omit } from "@webhare/std";


/** The format of the <script id="wh-config"> object  */
export type WHConfigScriptData = {
  //NOTE: existing frontend code doesn't expect site/obj to ever be null. not sure if 'object' provides the best interface or whether we need some sort of 'unknown but an existing object'
  /** Page (targetobject) specific settings
   *  @deprecated Use setFrontendData for type-safe settings
  */
  obj: { [key: string]: unknown };
  /** Site specific settings
   *  @deprecated Use setFrontendData for type-safe settings
   */
  site: { [key: string]: unknown };

  /** Root URL of this site */
  siteRoot: string;
};

export type WHConfigScriptData_FromServer = WHConfigScriptData & { dtapStage: DTAPStage };

//names fields can still have when not yet republished
interface WHConfigScriptData_OldPublishFields {
  islive: boolean;
  dtapstage: DTAPStage;
  siteroot: string;
}

//fallback names with deprecation warnings
interface WHConfigScriptData_LegacyFields {
  /** @deprecated Use dtapStage in WH5.4+ */
  islive: boolean;
  /** @deprecated Use `dtapStage` from "\@webhare/env"; in WH5.4+ */
  dtapstage: DTAPStage;
  /** @deprecated Use `getSiteRoot` from "\@webhare/frontend"; in WH5.7+ */
  siteroot: string;
}

let config: WHConfigScriptData_FromServer | undefined;
let siteroot;
let dtapStage: DTAPStage = "production";

//if document is undefined, we're serverside or in a worker
const whconfigel = typeof document !== "undefined" ? document.querySelector('script#wh-config') : null;
if (whconfigel?.textContent) {
  const parsedConfig: WHConfigScriptData_FromServer & WHConfigScriptData_OldPublishFields = JSON.parse(whconfigel.textContent);
  config = omit(parsedConfig, ["siteroot", "dtapstage", "islive"]);

  //Fallbacks for pages last published with WH5.3 *and* pages published from HareScript which still emit lowercase props
  siteroot = parsedConfig.siteRoot ?? parsedConfig.siteroot!;
  dtapStage = parsedConfig.dtapStage ?? parsedConfig.dtapstage;
}

initEnv(dtapStage, '/');

if (typeof location !== "undefined")
  for (const flag of getBrowserDebugFlags('wh-debug'))
    debugFlags[flag] = true;


/** @deprecated frontendConfig has been deprecated. Switch to the getFrontendData system */
// Make sure we have obj/site as some sort of object, to prevent crashes on naive 'if ($wh.config.obj.x)' tests'
export const frontendConfig: WHConfigScriptData & {
  /** @deprecated Use `getLang().tag` in WH6.0+ & WH5.9.7 */
  locale?: string;
} = {
  ...config,
  obj: config?.obj || {},
  site: config?.site || {},
  siteRoot: siteroot || "",
  dtapstage: dtapStage,
  islive: dtapStage === "production" || dtapStage === "acceptance",
  siteroot: siteroot || "",
} as WHConfigScriptData & WHConfigScriptData_LegacyFields;

// this is what we actually store in the config object but is type-unsafe to access. Plugins still store data in the config object
export type WHConfigSerializedData = WHConfigScriptData & WHConfigScriptData_LegacyFields & { [key in keyof FrontendDataTypes]?: FrontendDataTypes[key] };

if (typeof document !== "undefined") {
  frontendConfig.locale = getLang().tag;
}

if (dtapStage === "development") { //WH6.0: it's time to hard phase-out the old fields
  Object.defineProperties(frontendConfig, {
    islive: { get() { throw new Error("frontendConfig.islive will be removed - replace with testing 'dtapStage' for production | acceptance (WH5.4+)"); } },
    dtapstage: { get() { throw new Error("frontendConfig.dtapstage will be removed - replace with 'dtapStage' (WH5.4+)"); } },
    siteroot: { get() { throw new Error("frontendConfig.siteroot will be removed - replace with 'getSiteRoot()' (WH5.7+)"); } },
    //TODO but only WH6 addded this property AND getLang so there's no phasing out yet.
    //locale: { get() { throw new Error("frontendConfig.locale will be removed - replace with getLang().tag in WH6.0+ & WH5.9.7"); } },
  });
}

//NOTE: These APIs need to live in init.ts so eg gtm.ts can access us without triggering a CSS reset through frontend.ts. When frontend.ts stops auto-resetting we might move it back

export function getFrontendData<Type extends keyof FrontendDataTypes>(type: Type, options: { allowMissing: true }): FrontendDataTypes[Type] | null;
export function getFrontendData<Type extends keyof FrontendDataTypes>(type: Type, options?: { allowMissing: boolean }): FrontendDataTypes[Type];

/** Get data exported by the response
 * @typeParam Type - The type of data to get
 * @param dataObject - The data object of data to get
 * @param allowMissing - If true, return null if the data object is missing. Otherwise throw an error
 * @example
```
  declare module "@webhare/frontend" {
    interface FrontendDataTypes {
      "mymodule:type": {
        test: number;
      };
    }
  }

  const data = getFrontendData("mymodule:type");
```
*/
export function getFrontendData<Type extends keyof FrontendDataTypes>(dataObject: Type, { allowMissing = false } = {}): FrontendDataTypes[Type] | null {
  const retval = (config as undefined | WHConfigSerializedData)?.[dataObject] as FrontendDataTypes[Type];
  if (!retval)
    if (allowMissing)
      return null;
    else
      throw new Error(`Missing frontend data object: ${dataObject}`);

  return retval;
}

/** Get the current site root
 *
 * @returns The site root URL (ending with a slash)
*/
export function getSiteRoot() { //now an API to improve treeshaking
  return frontendConfig.siteRoot;
}
