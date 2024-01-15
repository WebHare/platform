/* frontend-config parses the wh-config object in the browser and mocks any missing data. @webhare/env does not actually expose this config, @webhare/frontend does
   The frontend configuration is built in the SiteResponse's 'frontendConfig' member */

import { DTAPStage } from "./concepts";

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
}

//names fields can still have when not yet republished
export interface WHConfigScriptData_OldPublishFields {
  islive: boolean;
  dtapstage: DTAPStage;
  siteroot: string;
}

//fallback names with deprecation warnings
export interface WHConfigScriptData_LegacyFields {
  //TODO: once 5.4 is the expected baseline everwhere: /** @deprecated use import { isLive } from "@webhare/env"; in WH5.4 */
  islive: boolean;
  //TODO: once 5.4 is the expected baseline everwhere:/** @deprecated use import { dtapStage } from "@webhare/env"; in WH5.4 */
  dtapstage: DTAPStage;
  //TODO: once 5.4 is the expected baseline everwhere:/** @deprecated Renamed to siteRoot in WH5.4 */
  siteroot: string;
}

function getIntegrationConfig(): WHConfigScriptData & WHConfigScriptData_LegacyFields {
  let config;
  let dtapStage = DTAPStage.Production;
  if (typeof window !== 'undefined') { //check we're in a browser window, ie not serverside or some form of worker
    const whconfigel = typeof document != "undefined" ? document.querySelector('script#wh-config') : null;
    if (whconfigel?.textContent) {
      config = JSON.parse(whconfigel.textContent) as Partial<WHConfigScriptData & WHConfigScriptData_OldPublishFields & { dtapStage?: DTAPStage }>;

      //WH5.3 fallbacks
      if (config.siteroot)
        config.siteRoot = config.siteroot;

      //future versions of WebHare can just drop dtapStage and isLive on prod from the config object.
      dtapStage = config.dtapstage ?? config.dtapStage ?? dtapStage;
    }
  }

  // Make sure we have obj/site as some sort of object, to prevent crashes on naive 'if ($wh.config.obj.x)' tests'
  return {
    server: 0,
    ...config,
    obj: config?.obj || {},
    site: config?.site || {},
    siteRoot: config?.siteRoot || config?.siteroot || "",
    dtapstage: dtapStage,
    islive: ([DTAPStage.Production, DTAPStage.Acceptance]).includes(dtapStage!)
  } as WHConfigScriptData & WHConfigScriptData_LegacyFields;
}

export const frontendConfig = getIntegrationConfig();
