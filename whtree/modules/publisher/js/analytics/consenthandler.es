import * as cookie from "dompack/extra/cookie";
import * as dompack from 'dompack';

let consentstatus, cookiename, consentoptions;

/** Setup the consent handler
    @param usecookiename Name of the cookie. Should be identical for all sites sharing this consent, set to empty string if you store consent externally
    @param consentrequester Function to invoke if consent is unknown to eg trigger a cookie bar. This function will be immediately registered for invocation through dompack.onDomReady
    @cell options.cookiedomain Domain to which to bind the cookie, can be at most one level higher (eg '.example.net' for 'www.example.net')
    @cell options.cookieduration Duration to store or extend the consent, in days. Defaults to 365 */
export function setup(usecookiename, consentrequester, options)
{
  if(typeof usecookiename !== 'string')
    throw new Error("Cookiename must be of type 'string'");
  if(dompack.debugflags.cst)
    console.log(`[cst] consenthandler initialized. cookiename: '${usecookiename}'`);

  cookiename = usecookiename;
  consentoptions = { cookiedomain: null
                   , cookieduration: 365
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
  if(!(consentstatus && "c" in consentstatus)) //already missed it, so invoke
    return undefined;

  return consentstatus.c.includes(consentsetting);
}

//Set simple consent
export function setConsent(newsetting)
{
  if(cookiename === undefined)
    throw new Error("Invoke consenthandler.run before modifying consent state!");
  if(typeof newsetting != "object" || !Array.isArray(newsetting))
    throw new Error("Expecting an array in call to setConsent");

  consentstatus.c = newsetting.sort();//ensure stable order
  consentstatus.lc = (new Date()).toISOString();

  storeConsent();
  updateConsent();
}

function getConsentDetail()
{
  return { consent: consentstatus.c };
}

export function onConsent(type, callback)
{
  window.addEventListener("wh:consent-changed", evt =>
  {
    if(evt.detail.consent.includes(type))
      callback(evt.detail);
  });
  if(consentstatus && "c" in consentstatus && consentstatus.c.includes(type)) //already missed it, so invoke
    callback(getConsentDetail());
}

//Register callback for content changes
export function onConsentChange(callback)
{
  window.addEventListener("wh:consent-changed", evt => callback(evt.detail));
  if(consentstatus && "c" in consentstatus) //already missed it, so invoke
    callback(getConsentDetail());
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
  if(!("c" in consentstatus))
  {
    document.documentElement.dataset.whConsent = "unknown";
  }
  else
  {
    document.documentElement.dataset.whConsent = consentstatus.c.length ? consentstatus.c.join(" ") : "denied";
    dompack.dispatchCustomEvent(window, "wh:consent-changed", { bubbles:false, cancelable:false, detail: getConsentDetail() });
    dompack.onDomReady(updateConsentOverlays);
  }
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
