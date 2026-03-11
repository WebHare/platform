/* Bundle watcher

   note: to debug bundlewatcher on a 3rd party site, type this in the console: `document.cookie='wh-debug=devdebug'`
   */

import * as dompack from '@webhare/dompack';
import { getToolsSocketPromise } from "../support/connection";
import { debugFlags } from '@webhare/env';
import type { AssetPackBundleStatus } from '@mod-platform/js/assetpacks/api';
import { appendToArray, emplace } from '@webhare/std';
import type { ValidationMessageWithType } from '@mod-platform/js/devsupport/validation';
import { formatValidationMessage } from '@mod-platform/js/devsupport/messages';
import { getSettings } from '../support/settings';

export type UpdateAssetPacksEventDetail = {
  /** Set if compilation just completed (only for that event) */
  isCompilationComplete: boolean;
  /** Set if any package recompiled */
  hasCompiled: boolean;
  isAnyCompiling: boolean;
  isUnknown: boolean;
  anyErrors: boolean;
  anyWarnings: boolean;
  isStale: boolean;
  allMessages: ValidationMessageWithType[];
};

declare global {
  interface Window {
    whAssetPacks?: Record<string, string>;
  }
}
declare global {
  interface Window {
    whResetConsent: () => void;
  }
  interface GlobalEventHandlersEventMap {
    "wh-devkit:updateassetpacks": CustomEvent<UpdateAssetPacksEventDetail>;
  }
}

let wasCompiling = false, hasCompiled = false;

export type SocketBundleStatus = (AssetPackBundleStatus & { getstatuserror: "" }) | ({ getstatuserror: Exclude<string, ""> } & { outputtag: string });

type AssetPackInfo = {
  /** Version of currently loaded JS file (assetpacks will set this into window.whAssetPacks) */
  activeVersion: Date | null;
  /** Last compiled version */
  lastCompile?: Date;
  gotStatus?: boolean;
  isCompiling?: boolean;
  messages?: ValidationMessageWithType[];
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

export function watchAssetPack(assetpackname: string, options?: { compileStart: Date }) {
  assetpackname = assetpackname.replace('.', ':');
  const match = watched.get(assetpackname);
  if (match) {
    if (options?.compileStart && (!match.activeVersion || options.compileStart.getTime() !== match.activeVersion.getTime())) {
      match.activeVersion = options.compileStart;
      handleStatusUpdates([]);
    }
    return;
  }

  watched.set(assetpackname, {
    activeVersion: options?.compileStart || null,
  });
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

export function handleStatusUpdates(newPacks: SocketBundleStatus[]) {
  for (const inPack of newPacks) {
    if (inPack.getstatuserror) {
      console.error(`Error getting status for assetpack '${inPack.outputtag}': ${inPack.getstatuserror}`);
      continue;
    }

    const pack = inPack as AssetPackBundleStatus;
    const match = emplace(watched, pack.outputtag, { insert: () => ({ activeVersion: null }) });

    if (match.isCompiling && !pack.iscompiling && getSettings().cssReload)
      void reloadCSSForBundle(pack.outputtag);

    match.isCompiling = pack.iscompiling;
    match.messages = pack.messages;
    match.gotStatus = true;
    if (pack.lastcompile)
      match.lastCompile = pack.lastcompile;

    //TODO only when messages update
    for (const msg of pack.messages) {
      if (msg.type === "error" || getSettings().showWarnings)
        console.log(`(${pack.outputtag}: ${formatValidationMessage(msg)}`);
    }
  }

  if (debugFlags.devdebug)
    console.log(`[dev/debugjs] handled status updates`, newPacks, watched);

  const allMessages: ValidationMessageWithType[] = [];

  //Is compilation complete ?
  for (const [key, assetpack] of watched.entries()) {
    appendToArray(allMessages, assetpack.messages || []);

    if (assetpack.lastCompile && assetpack.activeVersion && assetpack.lastCompile.getTime() < (assetpack.activeVersion).getTime())
      console.error(`Assetpack ${key} actual compilationtime ${assetpack.activeVersion} is newer than lastcompile time ${assetpack.lastCompile.toISOString()} as reported by assetpack service - this may be caused by multiple assetpack controllers (or multiple WebHares) running`);
    else if (debugFlags.devdebug)
      console.log(`[dev/debugjs] Outdated pack: ${key}, activeversion=${assetpack.activeVersion?.toISOString()}, lastcompile=${assetpack.lastCompile!.toISOString()}`);
  }

  const inUnknownState = [...watched.entries()].filter(([key, assetpack]) => !assetpack.gotStatus).map(([key]) => key);
  const isCompiling = [...watched.entries()].filter(([key, assetpack]) => assetpack.isCompiling).map(([key]) => key);
  const hasErrors = [...watched.entries()].filter(([key, assetpack]) => assetpack.messages?.some(m => m.type === "error")).map(([key]) => key);
  const hasWarnings = [...watched.entries()].filter(([key, assetpack]) => assetpack.messages?.some(m => m.type === "warning")).map(([key]) => key);
  const isStale = [...watched.entries()].filter(([key, assetpack]) => assetpack.lastCompile && assetpack.activeVersion && new Date(assetpack.activeVersion).getTime() !== assetpack.lastCompile.getTime()).map(([key]) => key);

  if (debugFlags.devdebug)
    console.log("[dev/debugjs] Current state", { inUnknownState, isCompiling, hasErrors, hasWarnings, isStale });

  const isCompilationComplete = wasCompiling && isCompiling.length === 0;
  wasCompiling = isCompiling.length > 0;
  if (isCompilationComplete)
    hasCompiled = true;

  dompack.dispatchCustomEvent(window, 'wh-devkit:updateassetpacks', {
    bubbles: true, cancelable: true, detail: {
      isCompilationComplete,
      isAnyCompiling: isCompiling.length > 0,
      isUnknown: watched.size === 0 || inUnknownState.length > 0,
      anyErrors: hasErrors.length > 0,
      anyWarnings: hasWarnings.length > 0,
      hasCompiled,
      isStale: isStale.length > 0,
      allMessages
    }
  });
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

export function markAllAsCompiling() {
  for (const assetpack of watched.values())
    assetpack.isCompiling = true;
  handleStatusUpdates([]);
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
      watchAssetPack(ap, { compileStart: new Date(date) });
    }
}, 1000);
