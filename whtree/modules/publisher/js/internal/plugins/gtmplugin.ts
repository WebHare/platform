
import { litty, type Litty } from "@webhare/litty";
import type { PagePluginFunction, PagePluginInit, PagePluginRequest } from "@webhare/router";
import { stringify } from "@webhare/std";
import { parseYamlPluginConfig } from "@webhare/whfs/src/applytester";

declare module "@webhare/frontend" {
  interface FrontendDataTypes {
    "socialite:gtm": {
      /** Account ID, usually GTM-XXXXXX */
      a: string;
      /** True if GTM is manually activated */
      m: boolean;
    };
  }
}

interface GTMPluginData {
  account: string;
  integration: "script" | "assetpack";
  launch: "pagerender" | "manual";
}

function printDataLayerPushes(hookdata: GTMPluginData, response: PagePluginRequest): Litty {
  if (!response.pageMetadata.dataLayer.length)
    return litty``;

  const pushes = response.pageMetadata.dataLayer.map(entry => stringify(entry, { target: "script" })).join(",");
  return litty`<script>window.dataLayer.push(${pushes})</script>`;
}

//wn-socialite-gtm pushes doesn't violate CSP .. but is not allowed in the <head> being a custom element,
function printInertPushes(hookdata: GTMPluginData, response: PagePluginRequest): Litty {
  if (!response.pageMetadata.dataLayer.length)
    return litty``;

  return litty`<wh-socialite-gtm push="${JSON.stringify(response.pageMetadata.dataLayer)}"></wh-socialite-gtm>`;
}

export function hookComposer(init: PagePluginInit, response: PagePluginRequest) {
  const hookdata = parseYamlPluginConfig<GTMPluginData>(init.settings);
  if (hookdata.account) {

    if (!hookdata.account.match(/^GTM-[A-Z0-9]{5}[A-Z0-9]*/))
      throw new Error("Invalid GTM account: " + hookdata.account);

    //FIXME skip the tags (but not any wh-socialite-datalayer nodes?) if webdesign->ispreviewpage

    //TODO implement all of gtmplugin.whlib
    //TODO stop calling ourselves socialite
    if (hookdata.integration === 'script' && hookdata.launch === 'pagerender') {
      //adding us as a simple script. our own JS has no control over when we get loaded but we follow the official source integration guide
      //hookdata.account is safe to embed without encoding if the above match passed.
      response.insertAt("dependencies-top",
        litty`<script>(function (w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='//www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${hookdata.account}');</script>`);
    } else {
      response.setFrontendData("socialite:gtm", { a: hookdata.account, m: hookdata.launch === 'manual' });
    }

    if (hookdata.launch === 'pagerender') {
      //The noscript code is probably always useful. no need to intercept it
      response.insertAt("body-bottom", litty`<noscript><iframe src="//www.googletagmanager.com/ns.html?id=${hookdata.account}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`);
    }
  }

  //Even if no account is configured we'll still process dataLayer pushes. We'll assume you've set up your own integration
  const useScriptPush = hookdata.integration === 'script' && hookdata.launch === 'pagerender';
  if (useScriptPush)
    response.insertAt("dependencies-bottom", () => printDataLayerPushes(hookdata, response));
  else
    response.insertAt("body-bottom", () => printInertPushes(hookdata, response));
}

//validate signatures
hookComposer satisfies PagePluginFunction;
