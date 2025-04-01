//@ts-ignore -- Dynamically generated so ignore anay errors
import { interfaceServers } from "wh:ts/public-config";
import { isHTMLElement } from "@webhare/dompack";

function forwardPublisherNavigation(event: Event) {
  /* we watch for clicks.. as we only want to update the Publisher's selection for user triggered actions (otherwise we'd
     start navigation in response to JS or internal link autoredirects) */
  if (!isHTMLElement(event.target))
    return;

  const navaction = event.target.closest<HTMLAnchorElement>('a[href]');
  if (!navaction)
    return;

  const desturl = navaction.href;
  if (desturl.split('#')[0] !== location.href.split('#')[0]) { //it's actual navigation...
    for (const origin of interfaceServers) {
      try {
        window.top?.postMessage({ type: "webhare-navigation", location: desturl }, origin);
      } catch (ignore) {
        //ignore crossdomain errors
      }
    }
  }
}

if (typeof window !== "undefined" && window !== window.top) { //if we're in an iframe, we may be running in WebHare and need to forward navigation events
  window.addEventListener("click", forwardPublisherNavigation);
}
