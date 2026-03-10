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
import { parseTyped, pick } from "@webhare/std";
import { devState } from "./support";
import { __settings, getSettings, type DevToolsSettings } from "./support/settings";

declare global {
  interface Window {
    //initialized by debugLoader so we should be able to assume its present
    __loadedDevTools: Set<string>;
  }
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

let bundlestatus: bundlewatcher.UpdateAssetPacksEventDetail | undefined;

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

function formatValidationMessage(msg: ValidationMessageWithType): string {
  return `${msg.resourcename}:${msg.line}:${msg.col}: ${msg.type[0].toUpperCase()}${msg.type.substring(1)}: ${msg.message}`;
}

function handleAssetPackStatus(newPacks: bundlewatcher.SocketBundleStatus[]) {
  bundlewatcher.handleStatusUpdates(newPacks);
  // updateAssetPackStatus();
}

function updateAssetPackStatus(event: CustomEvent<bundlewatcher.UpdateAssetPacksEventDetail>) {
  /*
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
  }*/

  if (event.detail.isAnyCompiling && getSettings().fullReload && !reloadonok) {
    toolbarWidget.updateState({ pageReloadScheduled: true });
    reloadonok = true;
  }

  if (event.detail.allMessages.length)
    setInfoNode({ messages: event.detail.allMessages });
  else
    clearInfoNode();

  if (filestatus)
    toolbarWidget.updateState({
      fileStatus: filestatus,
      bundleStatus: event.detail
    });

  bundlestatus = event.detail;
  checkReload();
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

      if (getSettings().fullReload && !reloadonok) {
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
    if (getSettings().resourceReload)
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

function checkReload() { //TODO move to bundlewatcher? that one explicitly tracks isCompilationComplete as an edge trigger. but doesn't know about FileStatus
  if (!reloadonok)
    return;

  const bundle_done = !bundlestatus || (!bundlestatus.isAnyCompiling);
  const file_done = !filestatus || (!filestatus.isdeleted && !filestatus.ispublishing);
  if (bundle_done && file_done) {
    const bundle_ok = bundlestatus && !bundlestatus.isUnknown && !bundlestatus.anyErrors;
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



async function onPageReloadClick(e: MouseEvent) {
  console.log("onPageReloadClick", e);
  e.preventDefault();
  e.stopPropagation();
  if (!bundlestatus)
    return;

  const livesocket = await getToolsSocketPromise();
  toolbarWidget.updateState({ pageReloadScheduled: true });
  reloadonok = true;
  if (!bundlestatus || (!bundlestatus.isAnyCompiling && (!devState.hadrecompile || bundlestatus.anyErrors))) {
    livesocket.send(JSON.stringify({ type: 'recompileassetpack', uuids: bundlewatcher.getAllBundleIds() }));
    bundlewatcher.markAllAsCompiling(); //otherwise checkReload will think we're done immediaely
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
  if (!bundlestatus || (!bundlestatus.isAnyCompiling && bundlestatus.anyErrors)) {
    livesocket.send(JSON.stringify({ type: 'recompileassetpack', uuids: bundlewatcher.getAllBundleIds() }));
    bundlewatcher.markAllAsCompiling(); //otherwise checkReload will think we're done immediaely
    // bundlestatus.isCompiling = true;
    // updateToolbar();
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
    toolbarWidget.updateState({ fileStatus: filestatus });

  window.__loadedDevTools.add("devkit:devtools");
}

function initForFile(toolssocket: WebSocket) {
  toolssocket.send(JSON.stringify({ type: 'watchurl', url: window.location.href }));
  if (watchedresources.length)
    toolssocket.send(JSON.stringify({ type: 'watchresources', resources: watchedresources }));
}

function updateSettings(newSettings: Partial<DevToolsSettings>) {
  Object.assign(__settings, pick(newSettings, Object.keys(__settings) as Array<keyof DevToolsSettings>));

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

  document.documentElement.classList.toggle("wh-outputtool--showtools", __settings.tools);
  dompack.setLocal<DevToolsSettings>("whoutputtool-settings", __settings);
}

///////////////////////////////////////////////////////////////////////////
//
// Init
//

// Initialize and load settings
updateSettings(dompack.getLocal<Partial<DevToolsSettings>>("whoutputtool-settings") || {});
const toolbarWidget = new ToolbarWidget(getSettings(), {
  onPageReloadClick,
  onPageRepublishReloadClick,
  onSettingsUpdate: updateSettings
});

dompack.onDomReady(onDomReady);
setupWebsocket();
void getToolsSocketPromise().then(socket => initForFile(socket));

addEventListener("wh-devkit:updateassetpacks", e => updateAssetPackStatus(e));
