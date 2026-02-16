
import type { PagePluginFunction, PagePluginRequest } from "@webhare/router";

declare module "@webhare/frontend" {
  interface FrontendDataTypes {
    "socialite:gtm": {
      /** Account ID, usually GTM-XXXXXX */
      a: string;
      /** True if integration is selfhosted */
      h: boolean;
      /** True if GTM is manually activated */
      m: boolean;
      /** Override script URL, WH5.5/5.6 - FIXME only implemented in HareScript, not yet in TypeScript */
      s?: string;
    };
  }
}

interface GTMPluginData {
  account: string;
  integration: "script" | "assetpack" | "selfhosted";
  launch: "pagerender" | "manual";
  //optional for WH5.5/5.6: in case we *just* upgraded and still need to recompile CSP
  script?: string;
  pixel?: string;
}

export function hookComposer(response: PagePluginRequest, hookdata: GTMPluginData) {
  if (!hookdata.account)
    return;
  if (!hookdata.account.match(/^GTM-[A-Z0-9]{5}[A-Z0-9]*/))
    throw new Error("Invalid GTM account: " + hookdata.account);

  //FIXME skip the tags (but not any wh-socialite-datalayer nodes?) if webdesign->ispreviewpage

  //TODO implement all of gtmplugin.whlib
  //TODO stop calling ourselves socialite
  if (hookdata.integration === 'script' && hookdata.launch === 'pagerender') {
    //adding us as a simple script. our own JS has no control over when we get loaded but we follow the official source integration guide
    //hookdata.account is safe to embed without encoding if the above match passed.
    response.insertAt("dependencies-top",
      `<script>(function (w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='//www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${hookdata.account}');</script>`);
  } else {
    response.setFrontendData("socialite:gtm", { a: hookdata.account, h: hookdata.integration === 'selfhosted', m: hookdata.launch === 'manual' });
  }

  if (hookdata.launch === 'pagerender') {
    //The noscript code is probably always useful. no need to intercept it
    response.insertAt("body-bottom", `<noscript><iframe src="//www.googletagmanager.com/ns.html?id=${hookdata.account}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`);
  }
}

//validate signatures
hookComposer satisfies PagePluginFunction<GTMPluginData>;
