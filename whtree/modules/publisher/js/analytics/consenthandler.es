import * as cookie from "dompack/extra/cookie";
import * as dompack from 'dompack';

let consentstatus, cookiename, consentoptions;

/** Setup the consent handler
    @param usecookiename Name of the cookie. Should be identical for all sites sharing this consent, set to empty string if you store consent externally
    @param consentrequester Function to invoke if consent is unknown to eg trigger a cookie bar. This function will be immediately registered for invocation through dompack.onDomReady
    @cell options.cookiedomain Domain to which to bind the cookie, can be at most one level higher (eg '.example.net' for 'www.example.net')
    @cell options.cookieduration Duration to store or extend the consent, in days. Defaults to 365
    @cell options.defaultconsent The consent tags which are active by default (only use this for anonymous tracking and functional cookies)
*/
export function setup(usecookiename, consentrequester, options)
{
  if(typeof usecookiename !== 'string')
    throw new Error("Cookiename must be of type 'string'");
  if(dompack.debugflags.cst)
    console.log(`[cst] consenthandler initialized. cookiename: '${usecookiename}'`);

  cookiename = usecookiename;
  consentoptions = { cookiedomain: null
                   , cookieduration: 365
                   , defaultconsent: []
                   , ...options
                   };

  try
  {
    consentstatus = consentrequester ? JSON.parse(cookie.read(cookiename)) : null;
    if(dompack.debugflags.cst)
      console.log(`[cst] initial consent state:`, consentstatus);
  }
  catch(ignore)
  {
  }

  if(!consentstatus || typeof consentstatus != "object" || consentstatus.v !== 2 || typeof consentstatus.c != "object")
    consentstatus = { v: 2 };

  if(!("c" in consentstatus))  //simple consent flag
  {
    if(consentrequester)
      dompack.onDomReady(consentrequester); //run the request function, but only on domready! it's a safe assumption it should be delayed...
  }
  else
  {
    storeConsent(); //renew the status
  }
  updateConsent();
}

//Test for consent
export function hasConsent(consentsetting)
{
  if(consentsetting === undefined) //generic consent check
    throw new Error("hasConsent required a string argument");

  let details = getConsentDetail();
  if (   !details // setup() not called yet?
      || !details.consent) // no consent has been given and no defaults are available consent will be undefined?
    return undefined;

  return details.consent.includes(consentsetting);
}

//Set simple consent
export function setConsent(newsetting)
{
  if(cookiename === undefined)
    throw new Error("Invoke consenthandler.setup before modifying consent state!");
  if(typeof newsetting != "object" || !Array.isArray(newsetting))
    throw new Error("Expecting an array in call to setConsent");

  // Check if there are some consents being revoked
  let details = getConsentDetail(); // get current list of consent tags, including implicit (default) consent
  let consent_revoked = false;
  if (details.consent) // if no explicit or default consent, the consent field is undefined
  {
    for (let tag of details.consent)
    {
      if (!newsetting.includes(tag))
        consent_revoked = true;
    }
  }

  consentstatus.c = newsetting.sort();//ensure stable order
  consentstatus.lc = (new Date()).toISOString();

  storeConsent();

  // Revoked consent may need a reload to take effect.
  // This is because it's not worth the effort for most websites to implement on-the-fly disabling
  // of functionality. It might even be impossible if 3rd party scripts are already loaded.
  if (consent_revoked)
    window.location.reload();

  updateConsent();
}

/** @short get a list of consents and whether they are defaults (or explicitly set)
    @param return.consent list all consents
    @param return.isdefault if TRUE then the consents are implicit/defaults (not consent explicitly given by the user)
*/
function getConsentDetail()
{
  if (!consentstatus) // setup() did not run yet
    return null;

  if(!("c" in consentstatus)) // consent not set yet
  {
    if (consentoptions.defaultconsent.length > 0)
      return { consent: consentoptions.defaultconsent, isdefault: true }; // use fallback consent
    else
      return { consent: undefined, isdefault: false }; // no consent given yet (expected to return undefined for consent)
  }

  return { consent: consentstatus.c
         , isdefault: false
         };
}

export function onConsent(type, callback)
{
  window.addEventListener("wh:consent-changed", evt =>
  {
    if(evt.detail.consent.includes(type))
      callback(evt.detail);
  });

  let details = getConsentDetail();

  if (details && details.consent && details.consent.includes(type)) //already missed it, so invoke
  {
    if(dompack.debugflags.anl)
      console.info("[anl] Invoking callback", details);
    callback(getConsentDetail());
  }
}

//Register callback for content changes
export function onConsentChange(callback)
{
  window.addEventListener("wh:consent-changed", evt => callback(evt.detail));

  let details = getConsentDetail();

  if (details) //already missed it, so invoke
  {
    if(dompack.debugflags.anl)
      console.info("[anl] Invoking callback", details);
    callback(details);
  }
}

function updateConsentOverlays()
{
  let overlays = dompack.qSA(".wh-requireconsent__overlay");
  let consent = getConsentDetail().consent;

  if(dompack.debugflags.cst)
    console.log(`[cst] update ${overlays.length} consent overlay(s). consent: ${consent.length ? consent.join(', ') : "<none>"}`);

  overlays.forEach(overlay =>
  {
    let parent = dompack.closest(overlay, ".wh-requireconsent");
    if(parent && parent.dataset.whConsentRequired)
      overlay.hidden = consent.includes(parent.dataset.whConsentRequired);
  });
}

function updateConsent() //update in DOM, GTM, etc
{
  let details = getConsentDetail();

  if (   !details // setup() not called yet?
      || !details.consent) // no consent has been given and no defaults are available consent will be undefined?
  {
    document.documentElement.dataset.whConsent = "unknown"; // unknown - no explicit or explicit (options.defaultconsent) consent
    return;
  }

  document.documentElement.dataset.whConsent = details.consent.length ? details.consent.join(" ") : "denied";

    if(dompack.debugflags.anl)
      console.info("[anl] Firing wh:consent-changed with", details);

  dompack.dispatchCustomEvent(window, "wh:consent-changed", { bubbles:false, cancelable:false, detail: getConsentDetail() });
  dompack.onDomReady(updateConsentOverlays);
}

function storeConsent()
{
  if(cookiename !== undefined)
    cookie.write(cookiename, JSON.stringify(consentstatus), { duration: consentoptions.cookieduration, domain: consentoptions.cookiedomain });
}

window.whResetConsent = function()
{
  if(cookiename === undefined)
    throw new Error("Consent handler not setup");
  else if(!cookiename)
    throw new Error("Consent handler is not handling storage");

  cookie.remove(cookiename);
  location.reload();
};
