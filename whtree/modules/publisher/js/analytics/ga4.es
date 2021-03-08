/* import '@mod-publisher/js/analytics/ga4';
*/

import * as whintegration from '@mod-system/js/wh/integration';
import { promiseScript } from 'dompack/extra/preload';
import { onConsentChange } from "./consenthandler.es";

let ga4settings = whintegration.config["ga4"];
let loaded=false;

function load()
{
  if(loaded)
    return;

  window.gtag('js', new Date); //firing this too early causes issues with the GTM initialization, it causes it not to fire pageview triggers. they probably shouldnt' mix until we figure this out (send only once for both GTM/GA?)
  window.gtag('config', ga4settings.a);
  promiseScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga4settings.a));
  loaded = true;
}

if(!window.dataLayer)
   window.dataLayer = [];

if(!window.gtag)
{
  window.gtag = function()
  {
    window.dataLayer.push(arguments);
  };

  if(ga4settings && ga4settings.a && !ga4settings.m)
    load();
}

export function initOnConsent()
{
  if(!(ga4settings && ga4settings.a && ga4settings.m))
    console.error("<googleanalytics4/> tag must be configured with launch=manual to support initOnConsent");

  onConsentChange(consentsettings =>
  {
    if(consentsettings.consent.length)
     load();
  });
}

