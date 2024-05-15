/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as pxl from "@mod-consilio/js/pxl";
import * as dompack from 'dompack';
import * as whintegration from '@mod-system/js/wh/integration';
import './internal/debugmenu';
import * as settings from './internal/settings';

const appbase = location.href.split('?')[0];
let didinit;

//set up a promise we'll use to signal succesful offline mode
const offlinedeferred = Promise.withResolvers();
let swregistration;

function getAppName() {
  //we'll assume the webdesignname is the appname
  const settings = whintegration.config.designroot.match(/^\/.publisher\/sd\/([^\/]*)\/([^\/]*)\/$/);
  const module = settings[1];
  const webdesign = settings[2];
  return module + ':' + webdesign;
}

settings.setAppName(getAppName());

function sendSWRequestTo(sw, type, data) {
  return new Promise((resolve, reject) => {
    const msg_chan = new MessageChannel();
    msg_chan.port1.onmessage = event => {
      if (event.data && event.data.__throw)
        reject(new Error(event.data.__throw));
      else
        resolve(event.data);
    };
    // console.log(navigator.serviceWorker);
    // console.log(navigator.serviceWorker.controller);
    // navigator.serviceWorker.controller.postMessage({ swrequest: type, data }, [msg_chan.port2]);
    sw.postMessage({ swrequest: type, data }, [msg_chan.port2]);
  });
}

async function sendSWRequest(type, data) {
  //wait for SW to be available. (waiting for ready isn't safe, it may pick up an already installed SW but doesn't mean that onReady is done
  await offlinedeferred.promise;
  return sendSWRequestTo(swregistration.active, type, data);
}

export async function checkForUpdate() {
  return await sendSWRequest("checkversion", {
    pwauid: document.documentElement.dataset.whPwaUid,
    pwafileid: document.documentElement.dataset.whPwaFileid
  });
}
export async function downloadUpdate() {
  return await sendSWRequest("downloadupdate");
}
//install downloaded update now
export async function updateApplication() {
  location.reload();
  return new Promise((resolve, reject) => setTimeout(() => reject(new Error("The update failed")), 20000)); //timeout 20 sec...
}


export async function onReady(initfunction, options) {
  if (didinit)
    throw new Error("pwalib.onReady should be invoked only once");

  didinit = true;

  //figure out the base of the app we have to work with
  if (!location.href.startsWith(whintegration.config.siteroot)) {
    alert("You cannot access a PWA app using a URL outside its site.\n\nThe WebHare 'preview' is not supported by a PWA");
    return;
  }
  if (!appbase.endsWith('/')) {
    //we might redirect deeper.. but this shouldn't happen anyway
    alert("The application base URL must end with a /");
    return;
  }


  options = {
    reportusage: false,
    ...options
  };

  if (options.reportusage) {
    //determinate app name. we should probably get Versioninfo and webhare/other version numbers too
    pxl.sendPxlEvent("publisher:pwastart", { ds_appname: settings.getAppName() });
  }

  //wait for dompack to be ready...
  await new Promise(resolve => dompack.onDomReady(resolve));

  //we can now run initialization which can do some basic UI setup
  initfunction();

  //bind it to user given clalbacks
  if (options.onAvailableOffline)
    offlinedeferred.promise = offlinedeferred.promise.then(() => options.onAvailableOffline());
  if (options.onOfflineFailed) //we need to chain our catch to the new promise above or we risk a "unhandled rejection" - https://stackoverflow.com/questions/52409326/unhandled-promise-rejection-despite-catching-the-promise
    offlinedeferred.promise = offlinedeferred.promise.catch(e => options.onOfflineFailed(e));

  //and we can start registration
  if (!("serviceWorker" in navigator)) {
    offlinedeferred.reject(new Error("This browser does not support serviceWorker"));
    return;
  }
  if (window.isSecureContext === false) {
    offlinedeferred.reject(new Error("This webpage is not running in a secure context (https or localhost)"));
    return;
  }

  let swurl = "/.publisher/common/pwa/serviceworker/ap.mjs?app=" + encodeURIComponent(settings.getAppName());
  if (document.getElementById("wh-publisher-outputtools"))
    swurl += "&debug=1";

  try {
    swregistration = await navigator.serviceWorker.register(swurl, { scope: appbase });

    if (swregistration.installing) //detect an installing worker going straight to redundant
    {
      swregistration.installing.addEventListener("statechange", event => {
        if (event.target.state === "redundant")
          offlinedeferred.reject(new Error("The serviceWorker failed to install"));
      });
    }

    navigator.serviceWorker.ready.then(() => offlinedeferred.resolve());
  } catch (e) {
    console.log("PWA Registration failed", (e as Error).message);
    offlinedeferred.reject(e);
  }
}

//inform any serviceworkers that a pwalib app has connected. gives them a chance to watch for forced version checks
async function precheckExistingWorkers() {
  if (!navigator.serviceWorker)
    return;

  const registrations = await (navigator.serviceWorker.getRegistrations());
  for (const sw of registrations)
    if (sw.active && sw.scope === appbase)
      sendSWRequestTo(sw.active, 'loading',
        {
          pwasettings: whintegration.config.obj.pwasettings,
          pwauid: document.documentElement.dataset.whPwaUid,
          pwafileid: document.documentElement.dataset.whPwaFileid
        });
}

function onServiceWorkerMessage(event) {
  if (event.data.type === 'forceRefresh') {
    location.reload(true);
    return;
  }
  if (event.data.type === "log") {
    console[event.data.loglevel]("[From ServiceWorker] " + event.data.message);
    return;
  }
  console.error("onServiceWorkerMessage", event.data);
}
navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
precheckExistingWorkers();
