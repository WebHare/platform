import { isHTMLElement } from "@webhare/dompack";
import type { CMSConfig } from "@mod-system/js/internal/generation/gen_misc_ts";

let config: CMSConfig | undefined;

function forwardPublisherNavigation(event: Event) {
  /* we watch for clicks.. as we only want to update the Publisher's selection for user triggered actions (otherwise we'd
     start navigation in response to JS or internal link autoredirects) */
  if (!isHTMLElement(event.target) || !config?.interfaceServers)
    return;

  const navaction = event.target.closest<HTMLAnchorElement>('a[href]');
  if (!navaction)
    return;

  const desturl = navaction.href;
  if (desturl.split('#')[0] !== location.href.split('#')[0]) { //it's actual navigation...
    for (const origin of config.interfaceServers) {
      try {
        window.top?.postMessage({ type: "webhare-navigation", location: desturl }, origin);
      } catch (ignore) {
        //ignore crossdomain errors
      }
    }
  }
}

async function configureForCMS() {
  try {
    const res = await fetch("/.wh/ea/config/cms.json");
    config = await res.json();
  } catch (e) {
    console.log("Failed to get CMS configuration", e);
    return;
  }
  window.addEventListener("click", forwardPublisherNavigation);
}

if (typeof window !== "undefined" && window !== window.top) { //if we're in an iframe, we may be running in WebHare and need to forward navigation events
  //we have no way to detect whether we're in a WebHare iframe or a 3rd party iframe. assume it's webhare and grab the interface servers
  void configureForCMS();
}
