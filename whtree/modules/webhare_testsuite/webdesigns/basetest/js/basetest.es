import * as dompack from 'dompack';
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';
import PollWebtool from "@mod-publisher/js/webtools/poll";
import ForumCommentsWebtool from "@mod-publisher/js/webtools/forumcomments";
import * as adaptivecontent from '@mod-publisher/js/contentlibraries/adaptivecontent';
import * as forms from '@mod-publisher/js/forms';

import * as geoip from '@mod-publisher/js/analytics/geoip';
import '@mod-publisher/js/richcontent/all';
import '@mod-publisher/js/analytics/gtm';
import './components.es';
import '@mod-webhare_testsuite/data/test/rte-structure.css';
import '@mod-webhare_testsuite/tests/publisher/contentlibraries/libs/actestpage.es';

require('../css/extra.scss');
require('./basetest.lang.json');
require('../pages/formtest/formtest');
require('../pages/wrdauthtest/wrdauthtest');
require('../pages/listtest/listtest');
require('../pages/customform2/customform2');

/////////////////////////////////////////////////////////
// Forms
import { getTid, getHTMLTid } from "@mod-tollium/js/gettid";

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
         , richtext: getHTMLTid("webhare_testsuite:test.richtext")
         , richtext_params: getTid.html("webhare_testsuite:test.richtext_params")
         };
};

import { setupGoogleRecaptcha } from "@mod-publisher/js/captcha/google-recaptcha";
setupGoogleRecaptcha();

//////////////////////////////////////////////////////////////////////////////
// Consent system
import * as ga4 from '@mod-publisher/js/analytics/ga4.es';
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

let urlparams = new URL(location.href).searchParams;
window.got_consent_analytics=false;
window.got_consent_remarketing = false;

if (urlparams.get("consent") == "1" || location.href.includes("testpages/consenttest"))
{
  let requiredconsent = urlparams.get("analyticsrequiredconsent");

  if(urlparams.get("gtmplugin_integration") != "none")
  {
    if (requiredconsent)
      console.error("requireconsent option not supported for GTM");

    gtm.initOnConsent();
  }
  if(urlparams.get("ga4_integration") != "none")
  {
    if (requiredconsent)
      ga4.initOnConsent({ requiredconsent: requiredconsent });
    else
      ga4.initOnConsent();
  }
}

if (urlparams.get("consent") == "1" || location.href.includes("testpages/consenttest") || urlparams.has("beaconconsent"))
{
  if(urlparams.has("defaultconsent"))
  {
    consenthandler.setup("webhare-testsuite-consent", startCookieRequest, { defaultconsent: urlparams.get("defaultconsent").split(",") });
  }
  else
    consenthandler.setup("webhare-testsuite-consent", startCookieRequest);

  consenthandler.onConsent('analytics', () => window.got_consent_analytics=true);
  consenthandler.onConsent('remarketing', () => window.got_consent_remarketing=true);
  dompack.register(".wh-requireconsent__overlay", overlay => overlay.addEventListener("click", startCookieRequest));
  window.hasConsent = consenthandler.hasConsent;
}

window.__testdcoptions = {};
if (urlparams.has("now"))
  window.__testdcoptions.now = new Date(urlparams.get("now"));
if (urlparams.get("beaconconsent"))
  window.__testdcoptions.beaconconsent = urlparams.get("beaconconsent");

adaptivecontent.setup(window.__testdcoptions);

window.geoip_getCountryCode = geoip.getCountryCode;
window.geoip_getIPInfo = geoip.getIPInfo;
