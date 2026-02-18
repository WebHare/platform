//TODO setup explicit devtools bridge types

import "./devtools.scss";
import "./validator";
import "./formprefiller";
import "./openineditor";
import * as dompack from '@webhare/dompack';
import * as bundlewatcher from "./bundlewatcher/bundlewatcher";
import { getToolsSocketPromise, toolssocketdefer } from "./support/connection";
import type { ValidationMessageWithType } from "@mod-platform/js/devsupport/validation";
import { debugFlags } from "@webhare/env";
import { ToolbarWidget } from "./toolbar/widget";
import { getToolsOrigin } from "./support/dtsupport";
import type { AssetPackBundleStatus } from "@mod-platform/js/devsupport/devbridge";
import { parseTyped, pick } from "@webhare/std";
import { devState } from "./support";

declare global {
  interface Window {
    //initialized by debugLoader so we should be able to assume its present
    __loadedDevTools: Set<string>;
  }
}

export class DevToolsSettings {
  //the values here are the defaults
  cssReload = true;
  fullReload = false;
  resourceReload = false;
  tools = true;
  showWarnings = true;
}

type WHOutputToolData = { //inferred, get from devbridge
  resources: string[];
};

type RenderingSummary = { //inferred type, link back to a devbridge type
  invokedwitties: Array<{
    component: string;
    data: unknown;
    stacktrace: Array<{
      filename: string;
      line: number;
      col: number;
      func: string;
    }>;
  }>;
};

// let toolbar_resstatus = null, toolbar_resreload = null, toolbar_resreloadcheck = null;
// let toolbar_fullreload = null, toolbar_fullreloadcheck = null;

let bundlestatus = {
  isUnknown: true,
  isCompiling: false,
  isStale: false,
  anyErrors: false,
  anyWarnings: false
};

export type BundleStatus = typeof bundlestatus;

export type FileStatus = {
  hasfile: boolean;
  isdeleted: boolean;
  ispublishing: boolean;
  isok: boolean;
  haswarnings: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO needs typing
let filestatus: FileStatus | null = null, whoutputtoolsdata: any = null;
let reloadonok = false;
/// Have we loaded outdated assetpacks already?  this is worse than outdated status which appears due to a recompile *after* pageload
const watchedresources = new Array<string>();
let infonode: HTMLElement | null = null;

const settings = new DevToolsSettings();

//Assets we've seen compiling so that we know to reload when they're done (TODO not really robust, we may have missed the recompile if its completion races page load)
const seenCompiling = new Set<string>;

function clearInfoNode() {
  if (infonode) {
    infonode.remove();
    infonode = null;
  }
}
function setInfoNode(data: { wait?: string; messages?: ValidationMessageWithType[] }) {
  if (!infonode) {
    infonode = document.createElement('wh-outputtools-info');
    document.body.appendChild(infonode);
  }

  infonode.classList.toggle("wh-outputtools-info--error", Boolean(data.messages?.some(msg => msg.type === "error")));
  //  infonode.classList.toggle("wh-outputtools-info--warning", Boolean(data.messages?.some(msg => msg.type === "warning")));

  infonode.classList.toggle("wh-outputtools-info--wait", Boolean(data.wait));

  infonode.textContent = '';
  const errors = data.messages?.filter(msg => msg.type === "error");
  if (errors?.length) {
    const errorlist = document.createElement('ul');
    infonode.appendChild(errorlist);
    errors.forEach(error =>
      errorlist.append(<li>{formatValidationMessage(error)}</li>)
    );
  } else {
    infonode.textContent = data.wait || '';
  }
}

type SocketBundleStatus = (AssetPackBundleStatus & { getstatuserror: "" }) | ({ getstatuserror: Exclude<string, ""> } & { outputtag: string });

function formatValidationMessage(msg: ValidationMessageWithType): string {
  return `${msg.resourcename}:${msg.line}:${msg.col}: ${msg.type[0].toUpperCase()}${msg.type.substring(1)}: ${msg.message}`;
}

let packs: SocketBundleStatus[] = [];

function handleAssetPackStatus(newPacks: SocketBundleStatus[]) {
  packs = newPacks;
  updateAssetPackStatus();
}

function updateAssetPackStatus() {
  if (packs.some(pack => pack.getstatuserror)) {
    console.warn("Your assetpack has been removed");
    for (const pack of packs) {
      if (pack.getstatuserror) {
        console.log(`${pack.outputtag}: ${pack.getstatuserror}`);
      }
    }
    bundlestatus.isUnknown = true;
    updateToolbar();
    return;
  }

  //NOTE: If we get here, no packs have a non-empty getstatus. activePacks is there to keep TS happy
  const activePacks = packs as AssetPackBundleStatus[];
  const doneCompiling = [...seenCompiling].filter(outputtag => !activePacks.some(pack => pack.outputtag === outputtag && pack.iscompiling));
  doneCompiling.forEach(outputtag => seenCompiling.delete(outputtag));
  activePacks.filter(pack => pack.iscompiling).forEach(pack => seenCompiling.add(pack.outputtag));
  const anyCompiling = activePacks.some(pack => pack.iscompiling);
  const anyMessages = activePacks.some(pack => !pack.iscompiling && pack.messages.length);
  const outdated = activePacks.filter(pack => pack.lastcompile && window.whAssetPacks?.[pack.outputtag] && new Date(window.whAssetPacks[pack.outputtag]).getTime() !== pack.lastcompile.getTime());
  if (window.whAssetPacks && outdated.length) {
    for (const outdatedpack of outdated)
      if (outdatedpack.lastcompile!.getTime() < new Date(window.whAssetPacks?.[outdatedpack.outputtag]).getTime())
        console.error(`Assetpack ${outdatedpack.outputtag} actual compilationtime ${window.whAssetPacks[outdatedpack.outputtag]} is newer than lastcompile time ${outdatedpack.lastcompile!.toISOString()} as reported by assetpack service - this may be caused by multiple assetpack controllers running`);
      else if (debugFlags.devdebug)
        console.log(`[dev/debugjs] Outdated pack: ${outdatedpack.outputtag}, lastcompile=${outdatedpack.lastcompile!.toISOString()}, whAssetPacks=${window.whAssetPacks[outdatedpack.outputtag]}`);
  }
  const anyErrors = activePacks.some(pack => !pack.iscompiling && pack.messages.some(msg => msg.type === "error"));
  if (anyCompiling) {
    console.warn("Your assets are out of date and are being recompiled");
    if (debugFlags.devdebug)
      console.log(`[dev/debugjs] Currently compiling: ${activePacks.filter(pack => pack.iscompiling).map(pack => pack.outputtag).join(", ")}`);
    devState.hadrecompile = true;
    if (settings.fullReload && !reloadonok) {
      toolbarWidget.updateState({ pageReloadScheduled: true });
      reloadonok = true;
    }
    setInfoNode({ wait: "Your assets are out of date and are being recompiled" });
  } else if (anyMessages) {
    if (anyErrors)
      console.error("Your assets are out of date because of a compilation error");
    else
      console.warn("Your assets are reporting warnings");

    const messages = [];
    for (const pack of activePacks)
      for (const msg of pack.messages) {
        messages.push(msg);
        if (msg.type === "error" || settings.showWarnings)
          console.log(`(${pack.outputtag}: ${formatValidationMessage(msg)}`);
      }

    setInfoNode({ messages: messages });
  } else {
    if (debugFlags.devdebug)
      console.log(`[dev/debugjs] Currently not compiling`);
    clearInfoNode();
  }

  bundlestatus = {
    isUnknown: false,
    isCompiling: anyCompiling,
    isStale: outdated.length > 0,
    anyErrors: anyErrors,
    anyWarnings: activePacks.some(pack => pack.messages.some(msg => msg.type === "warning")),
  };
  updateToolbar();

  checkReload();

  for (const pack of doneCompiling)
    onCompilingDone(pack);
}


function handleToolssocketMessage(event: MessageEvent) {
  const msgdata = parseTyped(event.data);
  let i, realerrors;

  if (msgdata.type === "greeting")
    return;

  if (msgdata.type === "assetpacks") {
    handleAssetPackStatus(msgdata.packs);
    return;
  }
  if (msgdata.type === "file") {
    if (msgdata.ispreview)
      return;

    if (!msgdata.hasfile) {
      console.warn("This page is not associated with a file");
    } else if (msgdata.isdeleted) {
      console.warn("This file has been deleted");
    } else if (msgdata.ispublishing) {
      console.warn("This file is being republished");
      devState.hadrepublish = true;

      if (settings.fullReload && !reloadonok) {
        toolbarWidget.updateState({ pageRepublishReloadScheduled: true });
        reloadonok = true;
      }
    } else if (msgdata.haserrors) {
      console.error("Republishing this file failed with errors");
      console.log(msgdata.message);
    } else if (msgdata.haswarnings) {
      console.error("Republishing this file completed with warnings");
      console.log(msgdata.message);
    }

    const publishingdone = !msgdata.ispublishing && bundlestatus && !msgdata.haserrors;
    filestatus = { hasfile: msgdata.hasfile, isdeleted: msgdata.isdeleted, ispublishing: msgdata.ispublishing, isok: !msgdata.haserrors, haswarnings: msgdata.haswarnings };
    updateToolbar();

    checkReload();

    if (publishingdone && msgdata.haserrors) {
      realerrors = msgdata.info.errors;
      for (i = 0; i < realerrors.length; ++i)
        console.log(realerrors[i].message);
    }
    return;
  }
  if (msgdata.type === "resource-change") {
    devState.hadresourcechange = true;
    if (settings.resourceReload)
      reloadonok = true;
    updateToolbar();
    checkReload();
    return;
  }
  console.error("Unexpected message of type '" + msgdata.type + "'", event);
}

function setupWebsocket() {
  let toolssocket;
  try {
    toolssocket = new WebSocket('ws' + getToolsOrigin().substring(4) + "/.wh/mod/devkit/public/tools.whsock?source=" + encodeURIComponent(location.origin + location.pathname));
  } catch (e) {
    if (debugFlags.devdebug)
      console.error("[dev/debugjs] unable to set up websocket", e);
    return;
  }

  toolssocket.addEventListener('open', () => toolssocketdefer.resolve(toolssocket));
  toolssocket.addEventListener('message', handleToolssocketMessage);
}

function checkReload() {
  if (!reloadonok)
    return;

  const bundle_done = !bundlestatus || (!bundlestatus.isCompiling);
  const file_done = !filestatus || (!filestatus.isdeleted && !filestatus.ispublishing);
  if (bundle_done && file_done) {
    const bundle_ok = !bundlestatus.isUnknown && !bundlestatus.anyErrors;
    const file_ok = !filestatus || filestatus.isok;

    if (bundle_ok && file_ok) {
      /* we used to attempt to reload the parent iframe, that might have been useful with frontend tests? but is very annoying when developing iframed components */
      reloadonok = false;
      window.location.reload();
      console.log("Reloading scheduled");
    } else {
      console.log("Compilation/publishing failed, cancelling reload");
      reloadonok = false;
      toolbarWidget.updateState({
        pageReloadScheduled: false,
        pageRepublishReloadScheduled: false
      });
    }
  }
}

function onCompilingDone(bundletag: string) {
  if (debugFlags.devdebug)
    console.log(`[dev/debugjs] Compilation of ${bundletag} completed`);
  if (settings.cssReload)
    void bundlewatcher.reloadCSSForBundle(bundletag);
}


async function onPageReloadClick(e: MouseEvent) {
  console.log("onPageReloadClick", e);
  e.preventDefault();
  e.stopPropagation();
  if (!bundlestatus)
    return;

  const livesocket = await getToolsSocketPromise();
  toolbarWidget.updateState({ pageReloadScheduled: true });
  reloadonok = true;
  if (!bundlestatus || (!bundlestatus.isCompiling && (!devState.hadrecompile || bundlestatus.anyErrors))) {
    livesocket.send(JSON.stringify({ type: 'recompileassetpack', uuids: bundlewatcher.getAllBundleIds() }));
    bundlestatus.isCompiling = true;
    updateToolbar();
  }

  // Also republish if republishing had failed
  if (!filestatus || (!filestatus.ispublishing && !filestatus.isok)) {
    livesocket.send(JSON.stringify({ type: 'republishfile', url: window.location.href }));
    if (filestatus)
      filestatus.ispublishing = true;
    updateToolbar();
  }

  checkReload();
}

async function onPageRepublishReloadClick(e: MouseEvent) {
  console.log("onPageRepublishReloadClick", e);
  e.preventDefault();
  e.stopPropagation();
  if (!filestatus)
    return;

  const livesocket = await getToolsSocketPromise();
  toolbarWidget.updateState({ pageRepublishReloadScheduled: true });
  reloadonok = true;
  if (!filestatus || (!filestatus.ispublishing && (!devState.hadrepublish || !filestatus.isok))) {
    livesocket.send(JSON.stringify({ type: 'republishfile', url: window.location.href }));
    filestatus.ispublishing = true;
    updateToolbar();
  }

  // Also recompile if bundle compile failed
  if (!bundlestatus || (!bundlestatus.isCompiling && bundlestatus.anyErrors)) {
    livesocket.send(JSON.stringify({ type: 'recompileassetpack', uuids: bundlewatcher.getAllBundleIds() }));
    bundlestatus.isCompiling = true;
    updateToolbar();
  }

  checkReload();
}

function onDomReady() {
  window.addEventListener("wh:outputtools-extradata", function (evt: Event) { void processResourceData((evt as CustomEvent).detail); });

  updateToolbar();

  const renderingsummarynode = document.getElementById("wh-rendering-summary");
  if (renderingsummarynode) {
    const renderingsummary = JSON.parse(renderingsummarynode.textContent!) as RenderingSummary;
    if (renderingsummary.invokedwitties)
      renderingsummary.invokedwitties.forEach(function (witty, idx) {
        console.groupCollapsed("Witty #" + (idx + 1) + ": " + witty.component);
        console.log(witty.data);
        console.groupCollapsed("Stacktrace");
        witty.stacktrace.forEach(trace => {
          console.log(trace.filename + ":" + trace.line + ":" + trace.col + " " + trace.func);
        });
        console.groupEnd();
        console.groupEnd();
      });
  }

  whoutputtoolsdata = document.getElementById("wh-outputtoolsdata");
  if (whoutputtoolsdata) {
    whoutputtoolsdata = JSON.parse(whoutputtoolsdata.textContent);
    if (whoutputtoolsdata)
      void processResourceData(whoutputtoolsdata as WHOutputToolData);
  }
}

async function processResourceData(data: WHOutputToolData) {
  if (data.resources) {
    for (let i = 0; i < data.resources.length; ++i)
      if (watchedresources.indexOf(data.resources[i]) === -1)
        watchedresources.push(data.resources[i]);
  }

  const livesocket = await getToolsSocketPromise();
  livesocket.send(JSON.stringify({ type: 'watchresources', resources: watchedresources }));
}

function updateToolbar() {
  if (filestatus)
    toolbarWidget.updateState({
      fileStatus: filestatus,
      bundleStatus: bundlestatus
    });

  window.__loadedDevTools.add("devkit:devtools");
}

function initForFile(toolssocket: WebSocket) {
  toolssocket.send(JSON.stringify({ type: 'watchurl', url: window.location.href }));
  if (watchedresources.length)
    toolssocket.send(JSON.stringify({ type: 'watchresources', resources: watchedresources }));
}

function updateSettings(newSettings: Partial<DevToolsSettings>) {
  Object.assign(settings, pick(newSettings, Object.keys(settings) as Array<keyof DevToolsSettings>));

  if (newSettings.fullReload !== undefined) {
    if (devState.hadrecompile || devState.hadrepublish) {
      reloadonok = true;
      checkReload();
    }
  }

  if (newSettings.cssReload !== undefined) {
    if (devState.hadresourcechange) {
      reloadonok = true;
      checkReload();
    }
  }

  if (newSettings.resourceReload !== undefined) {
    if (devState.hadresourcechange) {
      reloadonok = true;
      checkReload();
    }
  }

  document.documentElement.classList.toggle("wh-outputtool--showtools", settings.tools);
  dompack.setLocal<DevToolsSettings>("whoutputtool-settings", settings);
}

///////////////////////////////////////////////////////////////////////////
//
// Init
//

// Initialize and load settings
updateSettings(dompack.getLocal<Partial<DevToolsSettings>>("whoutputtool-settings") || {});
const toolbarWidget = new ToolbarWidget(settings, {
  onPageReloadClick,
  onPageRepublishReloadClick,
  onSettingsUpdate: updateSettings
});

dompack.onDomReady(onDomReady);
setupWebsocket();
void getToolsSocketPromise().then(socket => initForFile(socket));

window.whDev = {
  watchAssetPack: bundlewatcher.watchAssetPack
};

addEventListener("wh-devkit:updateassetpacks", () => updateAssetPackStatus);
