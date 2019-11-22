import * as dompack from 'dompack';
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';
import PollWebtool from "@mod-publisher/js/webtools/poll";
import ForumCommentsWebtool from "@mod-publisher/js/webtools/forumcomments";
import * as forms from '@mod-publisher/js/forms';

import * as geoip from '@mod-publisher/js/analytics/geoip';
import '@mod-publisher/js/richcontent/all';
import '@mod-publisher/js/analytics/gtm';
import '../css/basetest.scss';
require('../css/extra.scss');
require('./basetest.lang.json');
require('../pages/formtest/formtest');
require('../pages/wrdauthtest/wrdauthtest');
require('../pages/listtest/listtest');

/////////////////////////////////////////////////////////
// Forms
const getTid = require("@mod-tollium/js/gettid").getTid;

forms.setup({validate: true });
dompack.register('.wh-poll', node => new PollWebtool(node));
dompack.register('.wh-forumcomments', node => new ForumCommentsWebtool(node));

// used by /staticlogin/ for the webserver.accessrules test
document.addEventListener("wh:wrdauth-loginfailed", e =>
{
  let elt = document.getElementById("loginresult");
  if(elt)
  {
    e.preventDefault();
    elt.style.display = "inline";
    elt.className = "loginfailed";
  }
});

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

window.getTidTest = function()
{
  return { //this never used, but we want this for the tid scanner
           consolelog: getTid("webhare_testsuite:webdesigns.basetest.consolelog")
         , unicode2028: getTid("webhare_testsuite:test.unicode_2028")
         };
};

import { setupGoogleRecaptcha } from "@mod-publisher/js/captcha/google-recaptcha";
setupGoogleRecaptcha();

//////////////////////////////////////////////////////////////////////////////
// Consent system
import * as gtm from '@mod-publisher/js/analytics/gtm.es';
import * as consenthandler from '@mod-publisher/js/analytics/consenthandler.es';

window.revokeConsent = function() { consenthandler.setConsent([]); };

async function startCookieRequest()
{
  //launch a banner..
  let result = await dialogapi.runMessageBox("Cookies?", [{title:"remarketing"}, {title:"analytics"}, {title:"no"}]);
  if(result=="remarketing")
    consenthandler.setConsent(["remarketing","analytics"]);
  else if(result=="analytics")
    consenthandler.setConsent(["analytics"]);
  else
    consenthandler.setConsent([]);
}

if (location.href.includes("consent=1") || location.href.includes("testpages/consenttest"))
{
  window.got_consent_analytics=false;
  window.got_consent_remarketing = false;

  gtm.initOnConsent();
  consenthandler.setup("webhare-testsuite-consent", startCookieRequest);
  consenthandler.onConsent('analytics', () => window.got_consent_analytics=true);
  consenthandler.onConsent('remarketing', () => window.got_consent_remarketing=true);
  dompack.register(".wh-requireconsent__overlay", overlay => overlay.addEventListener("click", startCookieRequest));
  window.hasConsent = consenthandler.hasConsent;
}

window.geoip_getCountryCode = geoip.getCountryCode;
window.geoip_getIPInfo = geoip.getIPInfo;
