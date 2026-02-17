/* Bundle watcher

   note: to debug bundlewatcher on a 3rd party site, type this in the console: `document.cookie='wh-debug=devdebug'`
   */

import * as dompack from '@webhare/dompack';
import { getToolsSocketPromise } from "../support/connection";
import { debugFlags } from '@webhare/env';

declare global {
  interface Window {
    whAssetPacks?: Record<string, string>;
  }
}

type AssetPackInfo = {
  start: Date | null;
};

const watched = new Map<string, AssetPackInfo>;
const observing = new WeakSet;

function getAssetPackNameFromURL(url: string): string | null {
  return url.match(/\/\.wh\/ea\/ap\/(.+)\/ap\.(mjs|css)$/)?.[1] || null;
}

function getAssetPackFromTag(tag: HTMLElement) {
  const href = tag.matches('script[src]') ? (tag as HTMLScriptElement).src : tag.matches('link[rel=stylesheet]') ? (tag as HTMLLinkElement).href : '';
  if (!href)
    return null;

  const assetpackname = href.match(/\/\.wh\/ea\/ap\/(.+)\/ap\.(mjs|css)$/)?.[1];
  return assetpackname || null;
}

async function checkServiceWorkers() {
  for (const reg of await navigator.serviceWorker.getRegistrations()) {
    for (const field of ["active", "installing"] as const) {
      const url = reg[field]?.scriptURL;
      if (url) {
        const ap = getAssetPackNameFromURL(new URL(url).pathname);
        if (ap)
          watchAssetPack(ap);
      }
    }
  }
}

export function watchAssetPack(assetpackname: string, options?: { start: Date }) {
  assetpackname = assetpackname.replace(':', '.');
  const match = watched.get(assetpackname);
  if (match) {
    if (options?.start && (!match.start || options.start.getTime() !== match.start.getTime())) {
      match.start = options.start;
      dompack.dispatchCustomEvent(window, 'wh-devkit:updateassetpacks', { bubbles: true, cancelable: true });
    }
    return;
  }

  watched.set(assetpackname, { start: options?.start || null });
  void getToolsSocketPromise().then(socket => {
    if (debugFlags.devdebug)
      console.log(`[dev/debugjs] adding '${assetpackname}' to watch list`);
    socket.send(JSON.stringify({ type: 'watchassetpack', uuid: assetpackname }));
  });
}

function onMutation(mutationsList: MutationRecord[], observer: MutationObserver) {
  for (const tag of dompack.qSA(`script,link`)) {
    if (!observing.has(tag)) {
      observing.add(tag);
      observer.observe(tag, { attributes: true });
    }

    const assetpackname = getAssetPackFromTag(tag);
    if (assetpackname)
      watchAssetPack(assetpackname);
  }
}

export function getAllBundleIds() {
  const bundles = new Set;
  for (const tag of dompack.qSA(`script,link`)) {
    const assetpackname = getAssetPackFromTag(tag);
    if (assetpackname)
      bundles.add(assetpackname);
  }
  return [...bundles];
}

export async function reloadCSSForBundle(uuid: string) {
  if (debugFlags.devdebug)
    console.log(`[dev/debugjs] need to reload css for bundle '${uuid}'`);

  uuid = uuid.replace(':', '.');
  for (const tag of document.querySelectorAll<HTMLLinkElement>(`link[rel=stylesheet`)) {
    if (getAssetPackFromTag(tag) === uuid) {
      //force reload the css..
      const toload = tag.href;
      await fetch(tag.href, { "method": "GET", /*"credentials": "omit",*/ "cache": "reload" }); //TODO do we need omit? do we need to do something corsy-ignore-corsy?
      //trigger the css tag to reload
      tag.href = '';
      setTimeout(() => { tag.href = toload; }, 1);
    }
  }
}


// Observe the <head> for changes, expecting relevant <scripts> to be only here
const observer = new MutationObserver(onMutation);
observer.observe(document.head, { subtree: true, childList: true });
onMutation([], observer);

navigator.serviceWorker.addEventListener("controllerchange", () => void checkServiceWorkers());
void checkServiceWorkers();

// TODO we should replace whAssetPacks with a proxy to get instant updates
setInterval(() => {
  if (window.whAssetPacks)
    for (const [ap, date] of Object.entries(window.whAssetPacks)) {
      watchAssetPack(ap, { start: new Date(date) });
    }
}, 1000);
