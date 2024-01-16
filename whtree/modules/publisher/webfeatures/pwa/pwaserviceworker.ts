/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation
// Declare us as a service worker to TypeScript (load webworker types and inform TS that 'self' is actually a ServiceWorker)
/// <reference lib="webworker"/>
declare const self: ServiceWorkerGlobalScope;

// when developing, to explicitly recompile our package: wh assetpack recompile publisher:pwaserviceworker
import * as pwadb from '@mod-publisher/js/pwa/internal/pwadb';
import { generateRandomId } from "@webhare/std";
const serviceworkerurl = new URL(location.href);
const appname = serviceworkerurl.searchParams.get('app');
if (!appname)
  throw new Error("Unknown app name");

const debugassetpacks = serviceworkerurl.searchParams.get('debug') == '1';

const logprefix = `[SW ${appname} ${generateRandomId()}] `;

////////////////////////////////
//
// Database API.
//
// tests require that we don't keep it open indefinitely
//
let opendb, opendbpromise, opendbcloser, opendbusers, swstorecache = {};

async function openDatabase() {
  if (opendbcloser) {
    clearTimeout(opendbcloser);
    opendbcloser = 0;
  }

  if (!opendbpromise) {
    opendbpromise = pwadb.open(appname);
  }
  ++opendbusers;
  opendb = await opendbpromise;
  return opendb;
}

function scheduleDatabaseClose() {
  if (--opendbusers > 0)
    return;

  opendbcloser = setTimeout(timeoutDatabaseConnection, 1000);
}
function timeoutDatabaseConnection() {
  opendb.close();
  opendbpromise = null;
}

async function addToSwLog(data) {
  const db = await openDatabase();
  try {
    await db.add('pwa-swlog', { date: new Date(), ...data });
  } finally {
    scheduleDatabaseClose();
  }
}
async function getSwStoreValue(key) {
  if (key in swstorecache) //if we still persisted the key, return it. we can currently assume noone changes indexdb behind our back
    return swstorecache[key];

  const db = await openDatabase();
  try {
    return await db.get('pwa-keyval', key);
  } finally {
    scheduleDatabaseClose();
  }
}
async function setSwStoreValue(key, value) {
  const db = await openDatabase();
  try {
    swstorecache[key] = value;
    await db.put('pwa-keyval', value, key);
  } finally {
    scheduleDatabaseClose();
  }
}

function getWHConfig(pagetext) //extract and parse the wh-config tag
{
  const scriptpos = pagetext.indexOf('<script type="application/json" id="wh-config">');
  const scriptend = pagetext.indexOf('</script>', scriptpos);
  return JSON.parse(pagetext.substr(scriptpos + 47, scriptend - scriptpos - 47));
}

async function downloadApplication() {
  const cache = await caches.open("pwacache-" + appname);

  //FIXME we can't really assume that appname (webdesignname) == assetpackname
  const assetpackname = appname.replace(':', '.');

  //Get the easily guessed assets first
  //FIXME move user urls to the manifest ? how abotu th /sd/ urls?
  const mainpageurl = self.registration.scope;
  const assetbasedir = `/.ap/${assetpackname}${debugassetpacks ? '.dev' : ''}/`;
  const manifestfetch = fetch(`${assetbasedir}apmanifest.json`);
  const baseassets = debugassetpacks
    ? [
      "/.ap/tollium.polyfills/ap.js",
      `${assetbasedir}ap.css`,
      `${assetbasedir}ap.js`,
    ]
    : [
      `${assetbasedir}ap.css`,
      `${assetbasedir}ap.js`
    ];

  //make sure we get refresh versions, Safari seems to need this or it'll just reuse its browser cache
  const mainpagefetch = fetch(mainpageurl, { cache: 'reload' });
  const baseassetfetches = baseassets.map(asset => fetch(asset, { cache: 'reload' }));

  //we'll fetch it twice, as we cant reuse mainpagefetch for the cache (due to using its .text())
  //this can probably be done more efficiently, but at that point we should probably just create a Manifest or even Zip it all as a package
  //(fetch response clone might help, but not available on safari)
  const allassets = [mainpageurl].concat(baseassets);
  const allfetches = [fetch(mainpageurl, { cache: 'reload' })].concat(baseassetfetches);

  //parse mainpage to extract configuration info (TODO shouldn't we get this or the pwauid from the app pages? *they* might be out of date even though *we* see a newer version!)
  const mainpage = await mainpagefetch;
  const mainpagetext = await mainpage.text();
  const whconfig = getWHConfig(mainpagetext);
  if (!whconfig.obj.pwasettings)
    throw new Error("pwasettings not found in this page's settings. Is it properly derived from PWAPageBase?");

  const moreassets = whconfig.obj.pwasettings.addurls;
  const manifest = await (await manifestfetch).json();
  manifest.assets = manifest.assets.filter(el => !el.compressed && !el.sourcemap);
  manifest.assets.forEach(el => el.path = assetbasedir + el.subpath);

  //scrap the ones we already have
  for (const asset of [...baseassets, ...moreassets])
    manifest.assets = manifest.assets.filter(el => el.path != asset);

  moreassets.push(...manifest.assets.map(el => el.path));

  //this might lead us to get more assets..
  if (moreassets.length) {
    const morefetches = moreassets.map(asset => fetch(asset, { cache: 'reload' }));

    allassets.push(...moreassets);
    allfetches.push(...morefetches);
  }

  //get version info
  //FIXME race-safe way needed to ensure the packages and our cache token are in sync
  const versionresponse = await fetch("/.publisher/common/pwa/getversion.shtml?apptoken=" + encodeURIComponent(whconfig.obj.pwasettings.apptoken));
  const versioninfo = await versionresponse.json();

  //wait for the cache downloads to settle
  const allfetchresults = await Promise.all(allfetches);

  //add them to the cache, though we really need a putAll to do this atomically..
  await Promise.all(allassets.map((asset, idx) => cache.put(asset, allfetchresults[idx])));

  setSwStoreValue('debugassetpacks', debugassetpacks);
  setSwStoreValue('currentversion', versioninfo);
  setSwStoreValue('forcerefresh', new Date(versioninfo.forcerefresh));

  setSwStoreValue('installscope', self.registration.scope);
  setSwStoreValue('pwasettings', whconfig.obj.pwasettings);
}

async function doInitialAppInstallation() {
  try {
    console.log(`${logprefix}First we download our most important files`);
    await downloadApplication();
  } catch (e) {
    console.error("EXCEPTION", e); //make sure we log this!
    throw e;
  }
}

self.addEventListener('install', event => {
  console.log(`${logprefix}Install from ${location.href}`);
  console.log(`${logprefix}For app ${appname}`);
  console.log(`${logprefix}For scope ${self.registration.scope}`);

  addToSwLog({ event: 'install' });
  /* TODO are we sure we always want to do a full cache redownload on install? currently we probably cant avoid it as outside
          of dev the only way the serviceworker reinstalls is if we push the new module, which will recompile any pwa-dependent
          assets anyway */
  event.waitUntil(doInitialAppInstallation());

  self.skipWaiting();
});

async function logToAllClients(loglevel, message) {
  console.log(`${logprefix}${message}`);
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: "log", loglevel, message }));
}

async function startBackgroundVersionCheck(data) {
  console.log(`${logprefix}startBackgroundVersionCheck`, data);
  const versioninfo = await checkVersion({
    pwauid: data?.pwauid || null,
    pwafileid: data?.pwafileid || null
  });
  if (versioninfo.forcerefresh) {
    addToSwLog({ event: 'forcedrefresh' });
    await downloadApplication();

    const clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: "forceRefresh" }));
  }
}

self.addEventListener('activate', async function (event) {
  console.log(`${logprefix}Activated from`, location.href);
  console.log(`${logprefix}For scope`, self.registration.scope);

  //make sure we wrote activate to the log, at least for our tets...
  addToSwLog({ event: 'activate' });

  //Tell all our clients we are active - shouldn't be needed, clients can check serviceworker.ready ?
  //let clients = await self.clients.matchAll();
  //clients.forEach(client => client.postMessage({pwa: { status: "readyForOffline" }}));
});

////////////////////////////////////////////////////////
//
// Our cache/rewrite handling!
//

async function onFetch(event: FetchEvent) {
  // Let the browser do its default thing for non-GET requests.
  if (event.request.method != 'GET')
    return;

  const urlpath = new URL(event.request.url).pathname;
  if (urlpath.startsWith('/.publisher/common/outputtools/outputtools.')
    || urlpath.startsWith('/.wh/dev/')
    || urlpath.startsWith('/.dev/debug.js')
    || urlpath.startsWith('/.dev/debug.js')
    || urlpath.startsWith('/.ap/dev.devtools/')
    || urlpath.startsWith('/.publisher/sd/dev/devtools/')
    || urlpath.startsWith("/.px/")) {
    return;  //well known never cached files
  }

  event.respondWith(ourFetch(event));
}

async function ourFetch(event: FetchEvent) {
  const pwasettings = await getSwStoreValue("pwasettings");
  if (pwasettings && pwasettings.excludeurls && pwasettings.excludeurls.length) {
    for (const exclusionmask of pwasettings.excludeurls)
      if (event.request.url.startsWith(exclusionmask)) {
        return fetch(event.request);
      }
  }

  console.log(`${logprefix}Looking for`, event.request.url);

  //FIXME stop reopening them caches if we can
  const cache = await caches.open("pwacache-" + appname);
  const match = await cache.match(event.request);
  if (match) {
    console.log(`${logprefix}We have ${event.request.url} in our cache`);
    return match;
  }

  //FIXME should we log errors for things we HAD to download manually?
  addToSwLog({ event: 'miss', url: event.request.url });
  logToAllClients("warn", "[Service Worker] Unexpected cache miss for " + event.request.url);
  const response = await fetch(event.request);
  //Do NOT put in cache.. make the error repeatable
  return response;
}

self.addEventListener('fetch', onFetch);

async function checkVersion(clientversioninfo) {
  const pwasettings = await getSwStoreValue("pwasettings");
  const checkurl = "/.publisher/common/pwa/getversion.shtml?apptoken=" + encodeURIComponent(pwasettings.apptoken);
  const versionresponse = await fetch(checkurl); //FIXME ensure we avoid caches
  const versioninfo = await versionresponse.json();

  const currentversion = await getSwStoreValue("currentversion");
  const forcerefresh = await getSwStoreValue("forcerefresh");
  console.log(`${logprefix}checkversion`, { currentversion, clientversioninfo });
  return {
    needsupdate: (clientversioninfo && clientversioninfo.pwauid && versioninfo.pwauid && clientversioninfo.pwauid != versioninfo.pwauid)
      || versioninfo.updatetok != currentversion.updatetok,
    forcerefresh: new Date(versioninfo.forcerefresh) > forcerefresh
  };
}

async function downloadUpdate() {
  await downloadApplication();
  return null;
}

async function clientLoading(data) {
  startBackgroundVersionCheck(data); //no need to wait on this
}

async function onMessage(event: MessageEvent) {
  if (!event.data.swrequest)
    return;

  let response;
  switch (event.data.swrequest) {
    case "loading":
      response = await clientLoading(event.data.data);
      break;

    case "checkversion":
      response = await checkVersion(event.data.data);
      break;

    case "downloadupdate":
      response = await downloadUpdate();
      break;

    default:
      console.error("message", event);
      response = { __throw: `Unknown request type '${event.data.swrequest}'` };
      break;
  }
  event.ports[0].postMessage(response);

}

let sendingissuereport = false;

async function sendIssueReport(body) {
  if (sendingissuereport)
    return;

  try {
    sendingissuereport = true;

    let lastissuereports = await getSwStoreValue("issuereports") || [];

    if (lastissuereports.length >= 3 && (lastissuereports[0].when - new Date) < 3 * 60 * 10000) {
      console.log(`${logprefix}suppressing report, 3rd oldest report less than 3 minutes ago`, body);
      return;
    }

    body = {
      ...body,
      appname: appname,
      debugassetpacks: debugassetpacks,
      when: new Date
    };

    lastissuereports.push(body);
    if (lastissuereports.length > 3)
      lastissuereports = lastissuereports.slice(-3);

    await setSwStoreValue("issuereports", lastissuereports);
    await fetch('/.publisher/common/pwa/issuereport.shtml',
      {
        method: 'post',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json'
        }
      });
  } catch (e) {
    console.log(`${logprefix}Failed to report issue`, e);
  } finally {
    sendingissuereport = false;
  }
}

self.onerror = function (error) {
  console.error("Error", error, error.trace);
  sendIssueReport({
    type: "error",
    error: error.message,
    trace: error.trace
  });
};

addEventListener("unhandledrejection", function (event) {
  console.error('Unhandled rejection (promise: ', event.promise, ', reason: ', event.reason, event);
  sendIssueReport({
    type: "unhandledrejection",
    error: event.reason.message
  });
});


addEventListener("message", onMessage);
