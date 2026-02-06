/* frontend-config parses the wh-config object in the browser and mocks any missing data. @webhare/env does not actually expose this config, @webhare/frontend does
   The frontend configuration is built in PageBuildRequest's 'frontendConfig' member */

import type { DTAPStage } from "@webhare/env/src/concepts";
import { debugFlags, initEnv } from "@webhare/env/src/envbackend";
import { getBrowserDebugFlags } from "@webhare/env/src/init-browser";
import type { FrontendDataTypes } from "@webhare/frontend";


/** The format of the <script id="wh-config"> object  */
export interface WHConfigScriptData {
  ///Plugins may add keys at this level
  [key: string]: unknown;

  //NOTE: existing frontend code doesn't expect site/obj to ever be null. not sure if 'object' provides the best interface or whether we need some sort of 'unknown but an existing object'
  /** Page (targetobject) specific settings */
  obj: { [key: string]: unknown };
  /** Site specific settings */
  site: { [key: string]: unknown };

  /** Numeric server version number (eg 5.02.24 = 50224)
   *  @deprecated Interpreting numbers (or version strings) is dangerous. Feature flags/testing or limiting your entire module to compatible versions is safer
  */
  server: number;
  /** Root URL of this site */
  siteRoot: string;
  /** @deprecated Use `document.documentElement.lang` instead */
  locale: never;
}

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

type Configured = Partial<WHConfigScriptData & WHConfigScriptData_OldPublishFields & { dtapStage?: DTAPStage }>;
let config: Configured | undefined;
let siteroot;
let dtapStage: DTAPStage = "production";

//if document is undefined, we're serverside or in a worker
const whconfigel = typeof document !== "undefined" ? document.querySelector('script#wh-config') : null;
if (whconfigel?.textContent) {
  config = JSON.parse(whconfigel.textContent) as Configured;

  //Fallbacks for pages last published with WH5.3 *and* pages published from HareScript which still emit lowercase props
  siteroot = config.siteRoot ?? config.siteroot;
  dtapStage = config.dtapstage ?? config.dtapStage ?? dtapStage;
}

initEnv(dtapStage, '/');

if (typeof location !== "undefined")
  for (const flag of getBrowserDebugFlags('wh-debug'))
    debugFlags[flag] = true;


/** @deprecated frontendConfig has been deprecated. Switch to the getFrontendData system */
// Make sure we have obj/site as some sort of object, to prevent crashes on naive 'if ($wh.config.obj.x)' tests'
export const frontendConfig = {
  server: 0,
  ...config,
  obj: config?.obj || {},
  site: config?.site || {},
  siteRoot: siteroot,
  //deprecated variables:
  dtapstage: dtapStage,
  islive: (["production", "acceptance"]).includes(dtapStage!),
  siteroot
} as WHConfigScriptData & WHConfigScriptData_LegacyFields; //in a future version we can either obsolete or even drop '& WHConfigScriptData_LegacyFields' and validation will fail without breaking existing JS code


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
