import { debugFlags } from '@webhare/env';
import { loadScript } from '@webhare/dompack';
import { onConsentChange } from "./consenthandler";
import { getFrontendData } from '@webhare/frontend';

declare module "@webhare/frontend" {
  interface FrontendDataTypes {
    "platform:ga4": {
      /** Account */
      a: string;
      /** Manual load */
      m: boolean;
    };
  }
}

/** ga4 was used pre WH6.1 and may still be in published output */
const ga4settings = getFrontendData("platform:ga4", { allowMissing: true }) ?? getFrontendData<"platform:ga4">("ga4" as "platform:ga4", { allowMissing: true });
let loaded = false;

function load() { //no codepath should load() without ga4settings being set
  if (loaded)
    return;

  window.gtag('js', new Date); //firing this too early causes issues with the GTM initialization, it causes it not to fire pageview triggers. they probably shouldn't mix until we figure this out (send only once for both GTM/GA?)
  window.gtag('config', ga4settings!.a, { anonymize_ip: true });
  void loadScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga4settings!.a));
  loaded = true;
}

if (!window.dataLayer)
  window.dataLayer = [];

if (!window.gtag) {
  window.gtag = function <Command extends keyof Gtag.GtagCommands>(command: Command, ...args: Gtag.GtagCommands[Command]) {
    //@ts-expect-error TS doesn't like this, and it probably shouldn't. But it *has* to be an arguments object or datalayer won't understand it
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };

  if (ga4settings?.a && !ga4settings.m)
    load();
}

export function initOnConsent(options?: { requiredconsent?: string }) {
  const requiredconsent = options?.requiredconsent ?? "*";

  if (!(ga4settings && ga4settings.a && ga4settings.m)) {
    console.error("<googleanalytics4/> tag must be configured with launch=manual to support initOnConsent");
    return;
  }

  onConsentChange(consentsettings => {
    if (requiredconsent === "*") {
      if (consentsettings.consent?.length) {
        if (debugFlags.anl)
          console.log(`[anl] Got any consent, starting GA4`);
        load();
      }
    } else if (consentsettings.consent?.includes(requiredconsent)) {
      if (debugFlags.anl)
        console.log(`[anl] Got consent '${requiredconsent}', starting GA4`);
      load();
    } else {
      if (debugFlags.anl)
        console.log("[anl] No consent yet to start GA4");
    }
  });
}
