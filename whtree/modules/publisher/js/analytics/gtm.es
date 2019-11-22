/* import '@mod-publisher/js/analytics/gtm';
   enables ?wh-debug=anl support for GTM calls and implements non-script integration methods */
import * as dompack from 'dompack';
import { promiseScript } from 'dompack/extra/preload';
import * as whintegration from '@mod-system/js/wh/integration';
import { onConsentChange } from "./consenthandler.es";

let seen = 0;
let gtmsettings = whintegration.config["socialite:gtm"];
let didinit;
let eventname; //event name used for form submission

function showDataLayerChanges()
{
  if(!document.documentElement.classList.contains('dompack--debug-anl'))
    return false;

  for(;seen < window.dataLayer.length;++seen)
    console.log("[anl] dataLayer.push:", window.dataLayer[seen]);
  return true;
}

function watchDataLayer()
{
  if(!showDataLayerChanges())
    return;
  window.setTimeout(watchDataLayer,50);
}

/* Send variables to the data layer */
export function setVariables(vars)
{
  if(vars.event)
    throw new Error("An 'event' is not a a variable. use sendEvent for events");
  window.dataLayer.push(vars);
  showDataLayerChanges();
}

/* Send an event to the data layer. Returns a promise that will resolve when the event is sent, or after a timeout of 200ms */
export function sendEvent(event, vars)
{
  let defer = dompack.createDeferred();
  try
  {
    window.dataLayer.push({event:event,eventCallback:() => defer.resolve(false),...vars});
    showDataLayerChanges();
  }
  catch(e)
  {
  }
  window.setTimeout(() => defer.resolve(true), 200);
  return defer.promise;
}

function processGTMPluginInstruction(node)
{
  if(node.getAttribute("push"))
    window.dataLayer.push(...JSON.parse(node.getAttribute("push")));
}

export async function init()
{
  if(didinit)
    return false;

  didinit = true;
  window.dataLayer.push({'gtm.start':Date.now()});//, ...getLocalStorageKeys("wh-pretag")});

  //give other event handlers a chance to run and add their events
  await new Promise(resolve => window.setTimeout(resolve,1));
  window.dataLayer.push({event:'gtm.js'});

  if(gtmsettings.h && !dompack.debugflags.sne) //self hosting
  {
    //ADDME taking whintegration.config.designcdnroot would be nice, but it's current format is pretty unusable
    let src = "/.se/gtm." + gtmsettings.a.substr(4).toLowerCase() + ".js";
    try
    {
      await promiseScript(src);
      return; //done!
    }
    catch(e)
    {
      console.warn("Cannot load local GTM version at ",src);
      //fallback to loading GTM's version
    }
  }

  let gtmsrc = "https://www.googletagmanager.com/gtm.js?id=" + gtmsettings.a;
  promiseScript(gtmsrc);
}

export function initOnConsent()
{
  if(!(gtmsettings && gtmsettings.a && gtmsettings.m))
    console.error("<gtm/> tag must be configured with launch=manual to support initOnConsent");

  onConsentChange(consentsettings =>
  {
    let consentsetting = consentsettings.consent.length ? consentsettings.consent.join(' ') : "denied";
    window.dataLayer.push({"wh.consent":consentsetting, "event":"wh-consentchange"});
    init();
  });
}

///Accepts a pxl.sendPxlEvent compatible event and sends it to the data layer. This is generally done automatically by capturePxlEvent
export function sendPxlEventToDataLayer(target, event, vars, options)
{
  let datalayervars = {};
  if(target.dataset && target.dataset.gtmSubmit)
    datalayervars = JSON.parse(target.dataset.gtmSubmit);

  if(vars)
    Object.keys(vars).forEach(key =>
    {
      if(key.startsWith('ds_') || key.startsWith('dn_'))
        datalayervars[key.substr(3)] = vars[key];
      else if(key.startsWith('db_'))
        datalayervars[key.substr(3)] = vars[key] ? "true" : "false";
      else
        console.error("Invalid pxl event key, cannot be forwarded: ",key);
    });
  window.dataLayer.push({...datalayervars, event: event });
}

function capturePxlEvent(evt)
{
  sendPxlEventToDataLayer(evt.target, evt.detail.event, evt.detail.data, evt.detail.options);
}

//FIXME share with formbase es?
function collectFormValues(formnode)
{
  let donefields = {};
  let outdata = {};

  let multifields = dompack.qSA(formnode,'input[type=radio], input[type=checkbox]');
  for(let multifield of multifields)
  {
    if(!multifield.name || donefields[multifield.name])
      continue; //we did this one

    donefields[multifield.name] = true;

    let idx=0;
    let values = [];
    let labels = [];
    let checkboxes = multifields.filter(node => node.name == multifield.name);

    for(let node of checkboxes.filter(node => node.checked))
    {
      let keyname = 'form_' + multifield.name + (idx ? '_' + idx : '');
      let labelsfornode = dompack.qSA('label[for="' + node.id + '"]').map( labelnode => labelnode.textContent).filter(labelnode => !!labelnode).join(' ');
      labelsfornode = labelsfornode.trim(); //TODO normalize whitespace
      outdata[keyname] = node.value;
      outdata[keyname + '_label'] = labelsfornode;

      ++idx;
      values.push(node.value);
      labels.push(labelsfornode);
    }

    if(values.length)
    {
      let allkeyname = 'form_' + multifield.name + '_all';
      outdata[allkeyname] = values.join(';');
      outdata[allkeyname + '_label'] = labels.join(';');
    }
  }

  for(let field of formnode.querySelectorAll('input:not([type=radio]):not([type=checkbox]),select,textarea'))
  {
    if(!field.name || donefields[field.name])
      continue;

    donefields[field.name] = true;

    let val = field.value;
    outdata['form_' + field.name] = val;
    if(dompack.matches(field,'select'))
    {
      let opt = field.options[field.selectedIndex];
      if(opt)
        outdata['form_' + field.name + '_label'] = opt.dataset.gtmTag || opt.textContent;
    }
  }
  return outdata;
}

function onFormSubmit(evt)
{
  if(!evt.detail.form.dataset.gtmSubmit)
    return;

  let layerobj = { ...JSON.parse(evt.detail.form.dataset.gtmSubmit), ...collectFormValues(evt.detail.form) };
  if(eventname)
    layerobj.event = eventname;

  window.dataLayer.push(layerobj);
}

export function configureGTMFormSubmit(opts)
{
  if(opts.eventname)
    eventname = opts.eventname;
}

//ADDME if we ever figure out a webpack trick to flush this command to the top of all imports/loads, that would be great
if(!window.dataLayer)
  window.dataLayer=[];

window.addEventListener('dompack:debugflags-changed', watchDataLayer);
window.addEventListener('consilio:pxl', capturePxlEvent);
window.addEventListener("wh:form-values", onFormSubmit);

watchDataLayer();
dompack.register("wh-socialite-gtm", processGTMPluginInstruction);

if(gtmsettings && gtmsettings.a && !gtmsettings.m) //account is set, manual is not set
  init();

window.__gtmformsubmit = 1; //allow us to validate we're installed - ADDME compile only in dev mode
