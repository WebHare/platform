/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation
import * as frontend from "@webhare/frontend";
import './css/webinterface.scss';
import 'typeface-roboto';
import 'typeface-roboto-mono';
import './pages/harescripterror';
import './pages/manual';

import 'font-awesome/css/font-awesome.css';
import '@mod-wrd/js/auth';
import startTolliumShell from '@mod-tollium/shell';

//we manually manage the polyfills as we don't want the interface to recompile when the set of webservers changes. our assetpack has webharepolyfills="false"
import "@mod-publisher/js/internal/polyfills/modern";

if (document.documentElement.classList.contains('wh-shell')) {
  startTolliumShell(); //TODO perhaps
} else if (window.parent && document.documentElement.classList.contains("wh-tollium--manual")) {
  document.documentElement.addEventListener("click", event => {
    // Open external links in new window
    if (event.target.nodeName === "A" && !event.target.href.startsWith(frontend.config.siteroot))
      window.open(event.target.href);
  });
}
