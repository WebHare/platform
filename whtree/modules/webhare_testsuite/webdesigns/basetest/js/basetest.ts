/* eslint-disable @typescript-eslint/no-require-imports -- a lot of violations  */
import * as dompack from 'dompack';
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';
import PollWebtool from "@mod-publisher/js/webtools/poll";
import ForumCommentsWebtool from "@mod-publisher/js/webtools/forumcomments";
import * as adaptivecontent from '@mod-publisher/js/contentlibraries/adaptivecontent';
import * as formrpc from '@mod-publisher/js/forms/rpc';
import { verifyHareScriptAddress } from "@webhare/forms/src/address";

import * as geoip from '@mod-publisher/js/analytics/geoip';
import * as whintegration from "@mod-system/js/wh/integration";


import '@mod-publisher/js/richcontent/all';
import './components';
import '@mod-webhare_testsuite/data/test/rte-structure.css';
import '@mod-webhare_testsuite/tests/publisher/contentlibraries/libs/actestpage';

require('../css/extra.scss');
require('./basetest.lang.json');
require('../pages/formtest/formtest');
require('../pages/wrdauthtest/wrdauthtest');
require('../pages/customform2/customform2');
require('../pages/customformdef/customformdef');
require('../pages/exclusiveaccesstest/exclusiveaccesstest');

declare global {
  interface Window {
    geoip_getCountryCode: typeof geoip.getCountryCode;
    geoip_getIPInfo: typeof geoip.getIPInfo;
    __testdcoptions?: {
      now?: Date;
      beaconconsent?: string;
    };
    basetestErrorList: ErrorEvent[];
    got_consent_analytics?: boolean;
    got_consent_remarketing?: boolean;
    webharetestcontainer: boolean;
    gtm_consent?: string;
    gtm_event_consent?: string;
    hasConsent?: typeof consenthandler.hasConsent;
    whintegration_config: typeof whintegration.config;
    formrpc_submitForm: typeof formrpc.submitForm;
    formrpc_validateAddress: typeof verifyHareScriptAddress;
    getIconTest: () => Record<string, string>;
    revokeConsent: () => void;

  }
}

window.basetestErrorList = [];
window.addEventListener("error", (e: ErrorEvent) => window.basetestErrorList.push(e));

/////////////////////////////////////////
// Gallery (wh-gallery)
import setupGallery from '@mod-publisher/js/gallery/defaultgallery';
dompack.register('.wh-gallery', node => setupGallery(node));

/////////////////////////////////////////////////////////
// Forms

dompack.register('.wh-poll', node => new PollWebtool(node));
dompack.register('.wh-forumcomments', node => new ForumCommentsWebtool(node));

// used by /staticlogin/ for the webserver.accessrules test
document.addEventListener("wh:wrdauth-loginfailed", e => {
  const elt = document.getElementById("loginresult");
  if (elt) {
    e.preventDefault();
    elt.style.display = "inline";
    elt.className = "loginfailed";
  }
});

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

window.getIconTest = function () {
  return { //this never used, but we want this for the icon scanner
    consolelog: /*icon*/'tollium:status/not_available'
  };
};

import { setupGoogleRecaptcha } from "@mod-publisher/js/captcha/google-recaptcha";
setupGoogleRecaptcha();

//////////////////////////////////////////////////////////////////////////////
// Consent system
import * as ga4 from '@mod-publisher/js/analytics/ga4';
import * as gtm from '@mod-publisher/js/analytics/gtm';
import * as consenthandler from '@mod-publisher/js/analytics/consenthandler';
import { floatAsyncHandler } from '@mod-webhare_testsuite/js/testhelpers';
import { setupDataLayerTags, setupFormAnalyticsForGTM } from '@webhare/frontend';
import { setupFriendlyCaptcha } from '@webhare/forms';

window.revokeConsent = function () { consenthandler.setConsent([]); };

async function startCookieRequest() {
  //launch a banner..
  const result = await dialogapi.runMessageBox("Cookies?", [{ title: "remarketing" }, { title: "analytics" }, { title: "no" }]);
  if (result === "remarketing")
    consenthandler.setConsent(["remarketing", "analytics"]);
  else if (result === "analytics")
    consenthandler.setConsent(["analytics"]);
  else
    consenthandler.setConsent([]);
}

const urlparams = new URL(location.href).searchParams;
window.got_consent_analytics = false;
window.got_consent_remarketing = false;

if (urlparams.get("consent") === "1" || location.href.includes("testpages/consenttest")) {
  const requiredconsent = urlparams.get("analyticsrequiredconsent");

  if (urlparams.get("gtmplugin_integration") !== "none") {
    if (requiredconsent)
      console.error("requireconsent option not supported for GTM");

    gtm.initOnConsent();
  }
  if (urlparams.get("ga4_integration") !== "none") {
    if (requiredconsent)
      ga4.initOnConsent({ requiredconsent: requiredconsent });
    else
      ga4.initOnConsent();
  }
}

if (urlparams.get("consent") === "1" || location.href.includes("testpages/consenttest") || urlparams.has("beaconconsent")) {
  if (urlparams.has("defaultconsent")) {
    consenthandler.setup("webhare-testsuite-consent", floatAsyncHandler(startCookieRequest), { defaultconsent: urlparams.get("defaultconsent")!.split(",") });
  } else
    consenthandler.setup("webhare-testsuite-consent", floatAsyncHandler(startCookieRequest));

  consenthandler.onConsent('analytics', () => window.got_consent_analytics = true);
  consenthandler.onConsent('remarketing', () => window.got_consent_remarketing = true);
  dompack.register(".wh-requireconsent__overlay", overlay => overlay.addEventListener("click", floatAsyncHandler(startCookieRequest)));
  window.hasConsent = consenthandler.hasConsent;
}

window.__testdcoptions = {};
if (urlparams.has("now"))
  window.__testdcoptions.now = new Date(urlparams.get("now")!);
if (urlparams.get("beaconconsent"))
  window.__testdcoptions.beaconconsent = urlparams.get("beaconconsent")!;

adaptivecontent.setup(window.__testdcoptions);

window.geoip_getCountryCode = geoip.getCountryCode;
window.geoip_getIPInfo = geoip.getIPInfo;
window.whintegration_config = whintegration.config;
window.formrpc_submitForm = formrpc.submitForm;
window.formrpc_validateAddress = verifyHareScriptAddress;

if (urlparams.has("gtmFormEvents"))
  setupFormAnalyticsForGTM({ eventPrefix: urlparams.get("gtmFormEvents") || '' });

if (urlparams.has("setupdatalayertags"))
  setupDataLayerTags();

setupFriendlyCaptcha();
