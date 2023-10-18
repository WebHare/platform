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

  /** True if the current WebHare is in production or acceptance DTAP stage. Often used to show/hide developer-targed runtime warnings */
  islive: boolean;
  /** Current WebHare's DTAP stage */
  dtapstage: DTAPStage;
  /** Numeric server version number (eg 5.02.24 = 50224)
   *  @deprecated Interpreting numbers (or version strings) is dangerous. Feature flags/testing or limiting your entire module to compatible versions is safer
  */
  server: number;

  //TODO do we (still) need all these roots?
  siteroot: string;
}

function getIntegrationConfig(): WHConfigScriptData {
  let config;
  if (typeof window !== 'undefined') { //check we're in a browser window, ie not serverside or some form of worker
    const whconfigel = typeof document != "undefined" ? document.querySelector('script#wh-config') : null;
    if (whconfigel?.textContent) {
      config = JSON.parse(whconfigel.textContent) as Partial<WHConfigScriptData>;
    }
  }

  // Make sure we have obj/site as some sort of object, to prevent crashes on naive 'if ($wh.config.obj.x)' tests'
  return {
    islive: true,
    dtapstage: DTAPStage.Production,
    server: 0,
    ...config,
    obj: config?.obj || {},
    site: config?.site || {},
    siteroot: config?.siteroot || ""
  };
}

export const frontendConfig = getIntegrationConfig();
