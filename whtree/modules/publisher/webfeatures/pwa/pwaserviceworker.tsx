/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

// when developing, to explicitly recompile our package: wh assetpacks recompile publisher:pwaserviceworker
import * as pwadb from '@mod-publisher/js/pwa/internal/pwadb';

const serviceworkerurl = new URL(location.href);
const appname = serviceworkerurl.searchParams.get('app');
if (!appname)
  throw new Error("Unknown app name");

const debugassetpacks = serviceworkerurl.searchParams.get('debug') == '1';

function generateBase64UniqueID() {
  let u8array = new Uint8Array(16);
  crypto.getRandomValues(u8array);
  return btoa(String.fromCharCode.apply(null, u8array));
}
let logprefix = `[SW ${appname} ${generateBase64UniqueID()}] `;

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
  }
  finally {
    scheduleDatabaseClose();
  }
}
async function getSwStoreValue(key) {
  if (key in swstorecache) //if we still persisted the key, return it. we can currently assume noone changes indexdb behind our back
    return swstorecache[key];

  const db = await openDatabase();
  try {
    return await db.get('pwa-keyval', key);
  }
  finally {
    scheduleDatabaseClose();
  }
}
async function setSwStoreValue(key, value) {
  const db = await openDatabase();
  try {
    swstorecache[key] = value;
    await db.put('pwa-keyval', value, key);
  }
  finally {
    scheduleDatabaseClose();
  }
}

function getWHConfig(pagetext) //extract and parse the wh-config tag
{
  let scriptpos = pagetext.indexOf('<script type="application/json" id="wh-config">');
  let scriptend = pagetext.indexOf('</script>', scriptpos);
  return JSON.parse(pagetext.substr(scriptpos + 47, scriptend - scriptpos - 47));
}

async function downloadApplication() {
  let cache = await caches.open("pwacache-" + appname);

  //FIXME we can't really assume that appname (webdesignname) == assetpackname
  let assetpackname = appname.replace(':', '.');

  //Get the easily guessed assets first
  //FIXME move user urls to the manifest ? how abotu th /sd/ urls?
  let mainpageurl = self.registration.scope;
  let assetbasedir = `/.ap/${assetpackname}${debugassetpacks ? '.dev' : ''}/`;
  let manifestfetch = fetch(`${assetbasedir}apmanifest.json`);
  let baseassets = debugassetpacks
    ? ["/.ap/tollium.polyfills/ap.js"
      , `${assetbasedir}ap.css`
      , `${assetbasedir}ap.js`
      ,
    ]
    : [`${assetbasedir}ap.css`
      , `${assetbasedir}ap.js`
    ]

  //make sure we get refresh versions, Safari seems to need this or it'll just reuse its browser cache
  let mainpagefetch = fetch(mainpageurl, { cache: 'reload' });
  let baseassetfetches = baseassets.map(asset => fetch(asset, { cache: 'reload' }));

  //we'll fetch it twice, as we cant reuse mainpagefetch for the cache (due to using its .text())
  //this can probably be done more efficiently, but at that point we should probably just create a Manifest or even Zip it all as a package
  //(fetch response clone might help, but not available on safari)
  let allassets = [mainpageurl].concat(baseassets);
  let allfetches = [fetch(mainpageurl, { cache: 'reload' })].concat(baseassetfetches);

  //parse mainpage to extract configuration info (TODO shouldn't we get this or the pwauid from the app pages? *they* might be out of date even though *we* see a newer version!)
  let mainpage = await mainpagefetch;
  let mainpagetext = await mainpage.text();
  let whconfig = getWHConfig(mainpagetext);
  if (!whconfig.obj.pwasettings)
    throw new Error("pwasettings not found in this page's settings. Is it properly derived from PWAPageBase?")

  let moreassets = whconfig.obj.pwasettings.addurls;
  let manifest = await (await manifestfetch).json();
  manifest.assets = manifest.assets.filter(el => !el.compressed && !el.sourcemap);
  manifest.assets.forEach(el => el.path = assetbasedir + el.subpath);

  //scrap the ones we already have
  for (let asset of [...baseassets, ...moreassets])
    manifest.assets = manifest.assets.filter(el => el.path != asset);

  moreassets.push(...manifest.assets.map(el => el.path));

  //this might lead us to get more assets..
  if (moreassets.length) {
    let morefetches = moreassets.map(asset => fetch(asset, { cache: 'reload' }));

    allassets.push(...moreassets);
    allfetches.push(...morefetches);
  }

  //get version info
  //FIXME race-safe way needed to ensure the packages and our cache token are in sync
  let versionresponse = await fetch("/.publisher/common/pwa/getversion.shtml?apptoken=" + encodeURIComponent(whconfig.obj.pwasettings.apptoken));
  let versioninfo = await versionresponse.json();

  //wait for the cache downloads to settle
  let allfetchresults = await Promise.all(allfetches);

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
  }
  catch (e) {
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
  let clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: "log", loglevel, message }));
}

async function startBackgroundVersionCheck(data) {
  console.log(`${logprefix}startBackgroundVersionCheck`, data);
  let versioninfo = await checkVersion({
    pwauid: data?.pwauid || null
    , pwafileid: data?.pwafileid || null
  });
  if (versioninfo.forcerefresh) {
    addToSwLog({ event: 'forcedrefresh' });
    await downloadApplication();

    let clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: "forceRefresh" }));
  }
}

self.addEventListener('activate', async function(event) {
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

async function onFetch(event) {
  // Let the browser do its default thing for non-GET requests.
  if (event.request.method != 'GET')
    return;

  let urlpath = event.request.url.split('/').slice(3).join('/');
  if (urlpath.startsWith('.publisher/common/outputtools/outputtools.')
    || urlpath.startsWith('.dev/debug.js')
    || urlpath.startsWith('.ap/dev.devtools/')
    || urlpath.startsWith('.publisher/sd/dev/devtools/')
    || urlpath.startsWith(".px/")) {
    return;  //well known never cached files
  }

  event.respondWith(ourFetch(event));
}
async function ourFetch(event) {
  let pwasettings = await getSwStoreValue("pwasettings");
  if (pwasettings && pwasettings.excludeurls && pwasettings.excludeurls.length) {
    for (let exclusionmask of pwasettings.excludeurls)
      if (event.request.url.startsWith(exclusionmask)) {
        return fetch(event.request);
      }
  }

  console.log(`${logprefix}Looking for`, event.request.url);

  //FIXME stop reopening them caches if we can
  let cache = await caches.open("pwacache-" + appname);
  let match = await cache.match(event.request);
  if (match) {
    console.log(`${logprefix}We have ${event.request.url} + " in our cache`);
    return match;
  }

  //FIXME should we log errors for things we HAD to download manually?
  addToSwLog({ event: 'miss', url: event.request.url });
  logToAllClients("warn", "[Service Worker] Unexpected cache miss for " + event.request.url);
  let response = await fetch(event.request);
  //Do NOT put in cache.. make the error repeatable
  return response;
}

self.addEventListener('fetch', onFetch);

async function checkVersion(clientversioninfo) {
  let pwasettings = await getSwStoreValue("pwasettings");
  let checkurl = "/.publisher/common/pwa/getversion.shtml?apptoken=" + encodeURIComponent(pwasettings.apptoken);
  let versionresponse = await fetch(checkurl); //FIXME ensure we avoid caches
  let versioninfo = await versionresponse.json();

  let currentversion = await getSwStoreValue("currentversion");
  let forcerefresh = await getSwStoreValue("forcerefresh");
  console.log(`${logprefix}checkversion`, { currentversion, clientversioninfo });
  return {
    needsupdate: (clientversioninfo && clientversioninfo.pwauid && versioninfo.pwauid && clientversioninfo.pwauid != versioninfo.pwauid)
      || versioninfo.updatetok != currentversion.updatetok
    , forcerefresh: new Date(versioninfo.forcerefresh) > forcerefresh
  };
}

async function downloadUpdate() {
  await downloadApplication();
  return null;
}

async function clientLoading(data) {
  startBackgroundVersionCheck(data); //no need to wait on this
}

async function onMessage(event) {
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
      ...body
      , appname: appname
      , debugassetpacks: debugassetpacks
      , when: new Date
    };

    lastissuereports.push(body);
    if (lastissuereports.length > 3)
      lastissuereports = lastissuereports.slice(-3);

    await setSwStoreValue("issuereports", lastissuereports);
    await fetch('/.publisher/common/pwa/issuereport.shtml',
      {
        method: 'post'
        , body: JSON.stringify(body)
        , headers: {
          'Content-Type': 'application/json'
        }
      });
  }
  catch (e) {
    console.log(`${logprefix}Failed to report issue`, e);
  }
  finally {
    sendingissuereport = false;
  }
}

self.onerror = function(error) {
  console.error("Error", error, error.trace);
  sendIssueReport({
    type: "error"
    , error: error.message
    , trace: error.trace
  });
};

addEventListener("unhandledrejection", function(event) {
  console.error('Unhandled rejection (promise: ', event.promise, ', reason: ', event.reason, event);
  sendIssueReport({
    type: "unhandledrejection"
    , error: event.reason.message
  });
});


addEventListener("message", onMessage);
