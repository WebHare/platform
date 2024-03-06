/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import publicconfig from "@storage-system/js/publicconfig.json";

function forwardPublisherNavigation(event) {
  /* we watch for clicks.. as we only want to update the Publisher's selection for user triggered actions (otherwise we'd
     start navigation in response to JS or internal link autoredirects) */

  const navaction = event.target.closest('a[href]');
  if (!navaction)
    return;

  const desturl = navaction.href;
  if (desturl.split('#')[0] !== location.href.split('#')[0]) //it's actual navigation...
  {
    for (const origin of publicconfig.interfaces) {
      try {
        window.top.postMessage({ type: "webhare-navigation", location: desturl }, origin);
      } catch (ignore) {
        //ignore crossdomain errors
      }
    }
  }
}

if (window !== window.top) { //if we're in an iframe, we may be running in WebHare and need to forward navigation events
  window.addEventListener("click", forwardPublisherNavigation);
}
