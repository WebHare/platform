// Declare us as a service worker to TypeScript (load webworker types and inform TS that 'self' is actually a ServiceWorker)
/// <reference lib="webworker"/>
declare const self: ServiceWorkerGlobalScope;

import { getAssetPackBase } from '@mod-platform/js/concepts/frontend';
import type { AssetPackManifest } from '@mod-platform/js/assetpacks/types';
import * as pwadb from '@mod-publisher/js/pwa/internal/pwadb';
// when developing, to explicitly recompile our package: wh assetpack compile publisher:pwaserviceworker
import { generateRandomId, throwError } from "@webhare/std";
import type { IDBPDatabase } from 'idb';

export type PWACheckVersionResponse = {
  needsupdate: boolean;
  forcerefresh: boolean;
};

const serviceworkerurl = new URL(location.href);
const appname: string = serviceworkerurl.searchParams.get('app') ?? throwError("Unknown app name");

const logprefix = `[SW ${appname} ${generateRandomId()}] `;

interface ClientVersionInfo {
  pwauid: string | null;
  pwafileid: number | null;
}

interface ServerVersionInfo {
  updatetok: string;
  forcerefresh: string;
  pwauid: string;
}

interface PublishedPWASSettings { //see UpdatePWASettings
  apptoken: string;
  addurls: string[];
  excludeurls: string[];
}


////////////////////////////////
//
// Database API.
//
// tests require that we don't keep it open indefinitely
//

let opendb: IDBPDatabase<pwadb.PWADB> | undefined;
let opendbpromise: Promise<IDBPDatabase<pwadb.PWADB>> | undefined;
let opendbcloser: NodeJS.Timeout | undefined;
let opendbusers = 0;
const swstorecache: Record<string, unknown> = {};

async function openDatabase() {
  if (opendbcloser) {
    clearTimeout(opendbcloser);
    opendbcloser = undefined;
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
  opendb?.close();
  opendbpromise = undefined;
}

async function addToSwLog(data: object) {
  const db = await openDatabase();
  try {
    await db.add('pwa-swlog', { date: new Date(), ...data });
  } finally {
    scheduleDatabaseClose();
  }
}

interface SWStoreKeys {
  currentversion: ServerVersionInfo;
  forcerefresh: Date;
  installscope: string;
  pwasettings: PublishedPWASSettings;
  issuereports: IssueReport[];
}

async function getSwStoreValue<Key extends keyof SWStoreKeys>(key: Key): Promise<SWStoreKeys[Key] | undefined> {
  if (key in swstorecache) //if we still persisted the key, return it. we can currently assume noone changes indexdb behind our back
    return swstorecache[key] as SWStoreKeys[Key] | undefined;

  const db = await openDatabase();
  try {
    return await db.get('pwa-keyval', key) as SWStoreKeys[Key] | undefined;
  } finally {
    scheduleDatabaseClose();
  }
}
async function setSwStoreValue(key: string, value: unknown) {
  const db = await openDatabase();
  try {
    swstorecache[key] = value;
    await db.put('pwa-keyval', value, key);
  } finally {
    scheduleDatabaseClose();
  }
}

function getWHConfig(pagetext: string): {
  obj: {
    pwasettings: PublishedPWASSettings;
  };
  //FIXME the other whconfig props
} {
  //extract and parse the wh-config tag
  const scriptpos = pagetext.indexOf('<script type="application/json" id="wh-config">');
  const scriptend = pagetext.indexOf('</script>', scriptpos);
  const retval = JSON.parse(pagetext.substr(scriptpos + 47, scriptend - scriptpos - 47));
  if (!retval.obj.pwasettings)
    throw new Error("pwasettings not found in this page's settings. Is it properly derived from PWAPageBase?");
  return retval;
}

async function downloadApplication() {
  const cache = await caches.open("pwacache-" + appname);

  //FIXME we can't really assume that appname (webdesignname) === assetpackname
  const assetbasedir = getAssetPackBase(appname);

  //Get the easily guessed assets first
  //FIXME move user urls to the manifest ? how abotu th /sd/ urls?
  const mainpageurl = self.registration.scope;
  const manifestfetch = fetch(`${assetbasedir}apmanifest.json`);
  const baseassets = [
    `${assetbasedir}ap.css`,
    `${assetbasedir}ap.mjs`
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
  const moreassets = whconfig.obj.pwasettings.addurls;
  await cache.put(`${assetbasedir}apmanifest.json`, (await manifestfetch).clone());
  const manifest = await (await manifestfetch).json() as AssetPackManifest;

  const currentassets = new Set([...baseassets, ...moreassets]);
  const getassets = manifest.assets.filter(el => !el.compressed && !el.sourcemap).
    map(el => ({ ...el, path: assetbasedir + el.subpath })).
    //scrap the ones we already have
    filter(_ => !currentassets.has(_.path));

  moreassets.push(...getassets.map(el => el.path));

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

  await setSwStoreValue('currentversion', versioninfo);
  await setSwStoreValue('forcerefresh', new Date(versioninfo.forcerefresh));

  await setSwStoreValue('installscope', self.registration.scope);
  await setSwStoreValue('pwasettings', whconfig.obj.pwasettings);
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

  void addToSwLog({ event: 'install' });
  /* TODO are we sure we always want to do a full cache redownload on install? currently we probably cant avoid it as outside
          of dev the only way the serviceworker reinstalls is if we push the new module, which will recompile any pwa-dependent
          assets anyway */
  event.waitUntil(doInitialAppInstallation());

  void self.skipWaiting();
});

async function logToAllClients(loglevel: "warn", message: string) {
  console.log(`${logprefix}${message}`);
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: "log", loglevel, message }));
}

async function startBackgroundVersionCheck(data: ClientVersionInfo) {
  console.log(`${logprefix}startBackgroundVersionCheck`, data);
  const versioninfo = await checkVersion({
    pwauid: data?.pwauid || null,
    pwafileid: data?.pwafileid || null
  });
  if (versioninfo.forcerefresh) {
    void addToSwLog({ event: 'forcedrefresh' });
    await downloadApplication();

    const clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: "forceRefresh" }));
  }
}

self.addEventListener('activate', function (event) {
  console.log(`${logprefix}Activated from`, location.href);
  console.log(`${logprefix}For scope`, self.registration.scope);

  //make sure we wrote activate to the log, at least for our tets...
  void addToSwLog({ event: 'activate' });

  //Tell all our clients we are active - shouldn't be needed, clients can check serviceworker.ready ?
  //let clients = await self.clients.matchAll();
  //clients.forEach(client => client.postMessage({pwa: { status: "readyForOffline" }}));
});

////////////////////////////////////////////////////////
//
// Our cache/rewrite handling!
//

function onFetch(event: FetchEvent) {
  // Let the browser do its default thing for non-GET requests.
  if (event.request.method !== 'GET')
    return;

  const urlpath = new URL(event.request.url).pathname;
  if (urlpath.startsWith('/.publisher/common/outputtools/outputtools.')
    || urlpath.startsWith('/.wh/devkit/')
    || urlpath.startsWith('/.wh/mod/devkit/public/')
    || urlpath.startsWith(getAssetPackBase("devkit:devtools"))
    || urlpath.startsWith(getAssetPackBase("platform:authormode"))
    || urlpath.startsWith('/.wh/ea/config/') //TODO the publisher shouldn't fetch this for PWAs but publisher integration doesn't know about PWAs yet
    || urlpath.startsWith("/.px/") //old pxl url. new url introduced with WH5.7
    || urlpath.startsWith("/.wh/ea/pxl/")) {
    return;  //well known never cached files
  }

  event.respondWith(ourFetch(event));
}

async function ourFetch(event: FetchEvent) {
  if (!event.request.url.match(/^https?:\/\//))
    return fetch(event.request); //Not a real web fetch, eg might be a chrome-extension:// URL. ignore anything not HTTP related

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
  void addToSwLog({ event: "miss", url: event.request.url });
  void logToAllClients("warn", "[Service Worker] Unexpected cache miss for " + event.request.url);
  const response = await fetch(event.request);
  //Do NOT put in cache.. make the error repeatable
  return response;
}

self.addEventListener('fetch', onFetch);

async function checkVersion(clientversioninfo: ClientVersionInfo): Promise<PWACheckVersionResponse> {
  const pwasettings = await getSwStoreValue("pwasettings");
  if (!pwasettings)
    throw new Error("No PWASettings found in the store");
  const checkurl = "/.publisher/common/pwa/getversion.shtml?apptoken=" + encodeURIComponent(pwasettings.apptoken);
  const versionresponse = await fetch(checkurl, { cache: "reload" });
  const versioninfo = await versionresponse.json() as ServerVersionInfo;

  const currentversion = await getSwStoreValue("currentversion");
  const forcerefreshDate = await getSwStoreValue("forcerefresh");
  console.log(`${logprefix}checkversion`, { currentversion, clientversioninfo });

  const forcerefresh = Boolean(forcerefreshDate && new Date(versioninfo.forcerefresh) > forcerefreshDate);
  let needsupdate = forcerefresh || (clientversioninfo && clientversioninfo.pwauid && versioninfo.pwauid && clientversioninfo.pwauid !== versioninfo.pwauid)
    || versioninfo.updatetok !== currentversion?.updatetok;

  if (!needsupdate) { //check asssets
    const cache = await caches.open("pwacache-" + appname);
    for (const manifest of (await cache.keys()).filter(_ => new URL(_.url).pathname.match(/^\/\.wh\/ea\/ap\/.*\/apmanifest.json$/))) {
      const live = await fetch(manifest, { cache: "reload" });
      const cached = await cache.match(manifest);
      const liveText = await live.text();
      const cachedText = cached ? await cached.text() : null;
      if (liveText !== cachedText) {
        console.log(`${logprefix}Manifest ${manifest.url} changed, need update`, { liveText, cachedText });
        needsupdate = true;
        break;
      }
    }
  }

  return { needsupdate, forcerefresh };
}

async function downloadUpdate() {
  await downloadApplication();
  return null;
}

async function clientLoading(data: ClientVersionInfo) {
  void startBackgroundVersionCheck(data); //no need to wait on this
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

interface IssueReport {
  appname: string;
  when: Date;
  [key: string]: unknown;
}

async function sendIssueReport(body: object) {
  if (sendingissuereport)
    return;

  try {
    sendingissuereport = true;

    let lastissuereports = await getSwStoreValue("issuereports") ?? new Array<IssueReport>;

    if (lastissuereports.length >= 3 && (lastissuereports[0].when.getTime() - Date.now()) < 3 * 60 * 10000) {
      console.log(`${logprefix}suppressing report, 3rd oldest report less than 3 minutes ago`, body);
      return;
    }

    const issuebody = {
      ...body,
      appname: appname,
      when: new Date
    };

    lastissuereports.push(issuebody);
    if (lastissuereports.length > 3)
      lastissuereports = lastissuereports.slice(-3);

    await setSwStoreValue("issuereports", lastissuereports);
    await fetch('/.publisher/common/pwa/issuereport.shtml',
      {
        method: 'post',
        body: JSON.stringify(issuebody),
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
  console.error("Error", error);
  void sendIssueReport({
    type: "error",
    error: error.message
  });
};

addEventListener("unhandledrejection", function (event) {
  console.error('Unhandled rejection (promise: ', event.promise, ', reason: ', event.reason, event);
  void sendIssueReport({
    type: "unhandledrejection",
    error: event.reason.message
  });
});


addEventListener("message", (evt) => void onMessage(evt));
