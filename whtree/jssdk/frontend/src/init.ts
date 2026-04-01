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

  /** Numeric server version number (eg 5.02.24 = 50224)
   *  @deprecated Interpreting numbers (or version strings) is dangerous. Feature flags/testing or limiting your entire module to compatible versions is safer
  */
  server: number;
  /** Root URL of this site */
  siteRoot: string;
} & {
  ///Plugins may add keys at this level
  [key in keyof FrontendDataTypes]?: FrontendDataTypes[key];
};

export type WHConfigScriptData_FromServer = WHConfigScriptData & { dtapStage: DTAPStage };

//names fields can still have when not yet republished
export interface WHConfigScriptData_OldPublishFields {
  islive: boolean;
  dtapstage: DTAPStage;
  siteroot: string;
}

//fallback names with deprecation warnings
export interface WHConfigScriptData_LegacyFields {
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
export const frontendConfig: WHConfigScriptData & WHConfigScriptData_LegacyFields = {
  server: 0,
  ...config,
  obj: config?.obj || {},
  site: config?.site || {},
  siteRoot: siteroot || "",
  dtapstage: dtapStage,
  islive: dtapStage === "production" || dtapStage === "acceptance",
  siteroot: siteroot || "",
};

if (typeof document !== "undefined") {
  //@ts-expect-error -- locale isn't supposed to exist - but some old code is still referring to it
  frontendConfig.locale = getLang().tag;
}

if (dtapStage === "development") { //WH6.0: it's time to hard phase-out the old fields
  for (const prop of ["islive", "dtapstage", "siteroot", "locale"] as const)
    Object.defineProperty(frontendConfig, prop, {
      get() { throw new Error(`frontendConfig.${prop} will be removed`); }
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
  const retval = config?.[dataObject] as FrontendDataTypes[Type];
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
