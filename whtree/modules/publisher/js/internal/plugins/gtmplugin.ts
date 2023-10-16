import { SiteResponse } from "@webhare/router/src/sitereponse";
import { ComposerHookFunction } from "@webhare/router/src/siterequest";

interface GTMPluginData {
  account: string;
  integration: "script" | "assetpack" | "selfhosted";
  launch: "pagerender" | "manual";
}

export function hookComposer(hookdata: GTMPluginData, composer: SiteResponse) {
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
    composer.insertAt("dependencies-top",
      `<script>(function (w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='//www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${hookdata.account}');</script>`);
  } else {
    composer.setPluginConfig("socialite:gtm", { a: hookdata.account, h: hookdata.integration === 'selfhosted', m: hookdata.launch === 'manual' });
  }

  if (hookdata.launch === 'pagerender') {
    //The noscript code is probably always useful. no need to intercept it
    composer.insertAt("body-bottom", `<noscript><iframe src="//www.googletagmanager.com/ns.html?id=${hookdata.account}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`);
  }
}

//validate signatures
hookComposer satisfies ComposerHookFunction<GTMPluginData>;
