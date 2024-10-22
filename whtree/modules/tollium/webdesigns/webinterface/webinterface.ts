import { frontendConfig } from "@webhare/frontend";
import { isHTMLElement } from "@webhare/dompack";
import './css/webinterface.scss';
import 'typeface-roboto';
import 'typeface-roboto-mono';
import './pages/harescripterror';
import './pages/manual';

import 'font-awesome/css/font-awesome.css';
import '@mod-wrd/js/auth';
import startTolliumShell from '@mod-tollium/shell';

//we manually manage the polyfills as we don't want the interface to recompile when the set of webservers changes. our assetpack has webharepolyfills="false"
import "@webhare/tsrun/src/polyfills";
import "@mod-publisher/js/internal/polyfills/iterator-helpers";

if (document.documentElement.classList.contains('wh-shell')) {
  startTolliumShell(); //TODO perhaps
} else if (window.parent && document.documentElement.classList.contains("wh-tollium--manual")) {
  document.documentElement.addEventListener("click", event => {
    // Open external links in new window
    if (isHTMLElement(event.target) && event.target.nodeName === "A") {
      const href = (event.target as HTMLAnchorElement).href;
      if (!href.startsWith(frontendConfig.siteroot)) {
        window.open(href, "_blank", "noopener noreferrer");
        event.preventDefault();
      }
    }
  });
}
